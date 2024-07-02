import subprocess
from flask import Flask, request, redirect, jsonify, make_response
import threading
import time
import datetime

app = Flask(__name__)

# Define the subprocesses
pipeline_proxy_process = None
simple_server_process = None

# Global variables for tracking
last_alive_time = {
    'pipeline_proxy': None,
    'simple_server': None
}
autorestart_enabled = {
    'pipeline_proxy': False,
    'simple_server': False
}

def start_subprocesses():
    global pipeline_proxy_process, simple_server_process

    # start the proxy but redirect the output to a file 'logs/proxy'
    pipeline_proxy_process = subprocess.Popen(['./pipeline-proxy', '8000'], stdout=open('logs/proxy', 'w'), stderr=subprocess.STDOUT)

    # same for simple_server
    simple_server_process = subprocess.Popen(['python', 'simple_server.py', '8001'], stdout=open('logs/server', 'w'), stderr=subprocess.STDOUT)

def stop_subprocesses():
    global pipeline_proxy_process, simple_server_process
    if pipeline_proxy_process is not None:
        pipeline_proxy_process.terminate()
    if simple_server_process is not None:
        simple_server_process.terminate()

    # use fuser -k to kill 8000/tcp and 8001/tcp
    subprocess.run(['fuser', '-k', '8000/tcp'])
    subprocess.run(['fuser', '-k', '8001/tcp'])

def restart_subprocesses():
    stop_subprocesses()
    start_subprocesses()

def check_subprocesses():
    global pipeline_proxy_process, simple_server_process, last_alive_time
    proxy_alive = pipeline_proxy_process.poll() is None
    server_alive = simple_server_process.poll() is None
    
    if proxy_alive:
        last_alive_time['pipeline_proxy'] = datetime.datetime.now()
    if server_alive:
        last_alive_time['simple_server'] = datetime.datetime.now()
    
    return {'pipeline_proxy': proxy_alive, 'simple_server': server_alive}

def restart_process(process_name):
    global pipeline_proxy_process, simple_server_process
    if process_name == 'pipeline_proxy':
        if pipeline_proxy_process is not None:
            pipeline_proxy_process.terminate()
        subprocess.run(['fuser', '-k', '8000/tcp'])
        pipeline_proxy_process = subprocess.Popen(['./pipeline-proxy', '8000'], stdout=open('logs/proxy', 'w'), stderr=subprocess.STDOUT)
    elif process_name == 'simple_server':
        if simple_server_process is not None:
            simple_server_process.terminate()
        subprocess.run(['fuser', '-k', '8001/tcp'])
        simple_server_process = subprocess.Popen(['python', 'simple_server.py', '8001'], stdout=open('logs/server', 'w'), stderr=subprocess.STDOUT)

def liveness_check():
    global autorestart_enabled
    while True:
        subprocess_status = check_subprocesses()
        for process_name, is_alive in subprocess_status.items():
            if not is_alive and autorestart_enabled[process_name]:
                restart_process(process_name)
        time.sleep(60)  # Wait for 1 minute before next check

@app.route('/')
def index():
    with open('logs/proxy') as f:
        pipeline_proxy_logs = f.read()

    with open('logs/server') as f:
        simple_server_logs = f.read()

    subprocess_status = check_subprocesses()
    
    status_html = ""
    for process_name, is_alive in subprocess_status.items():
        status = 'Running' if is_alive else 'Not Running'
        last_alive = last_alive_time[process_name].strftime('%Y-%m-%d %H:%M:%S') if last_alive_time[process_name] else 'Never'
        status_html += f"<p>{process_name.replace('_', ' ').title()}: {status} (Last alive: {last_alive})</p>"

    return f"""
    <style>
    .log {{ 
        min-width: 50%; 
        max-width: 50%; 
        overflow: scroll;
        border: 1px solid black;
        border-radius: 5px;
    }}
    </style>
    <h1>Subprocesses Status</h1>
    {status_html}
    {subprocess.run(['fuser', '8000/tcp'], capture_output=True, text=True)}
    {subprocess.run(['fuser', '8001/tcp'], capture_output=True, text=True)}
    <form action="/restart" method="post">
        <input type="submit" value="Restart All Subprocesses">
    </form>
    
    <form action="/toggle_autorestart" method="post">
        <h3>Enable Autorestart:</h3>
        <label>
            <input type="checkbox" name="autorestart_pipeline_proxy" {'checked' if autorestart_enabled['pipeline_proxy'] else ''}>
            Pipeline Proxy
        </label><br>
        <label>
            <input type="checkbox" name="autorestart_simple_server" {'checked' if autorestart_enabled['simple_server'] else ''}>
            Simple Server
        </label><br>
        <input type="submit" value="Update Autorestart">
    </form>
    
    <h1>Logs</h1>
    <div style="display: flex;">
        <div class="log">
        Proxy Logs:
        <pre>{pipeline_proxy_logs}</pre>
        </div>

        <div class="log">
        Simple Server Logs:
        <pre>{simple_server_logs}</pre>
        </div>
    </div>
    """

@app.route('/restart', methods=['GET', 'POST'])
def restart():
    restart_subprocesses()
    return redirect('/')

@app.route('/toggle_autorestart', methods=['POST'])
def toggle_autorestart():
    global autorestart_enabled
    autorestart_enabled['pipeline_proxy'] = 'autorestart_pipeline_proxy' in request.form
    autorestart_enabled['simple_server'] = 'autorestart_simple_server' in request.form
    return redirect('/')

@app.route('/api/status', methods=['GET'])
def api_status():
    subprocess_status = check_subprocesses()

    # Add CORS header from origin 10.50.50.2:8000
    response = make_response(jsonify({"proxy": subprocess_status['pipeline_proxy'], 'server': subprocess_status['simple_server']}))
    response.headers.add('Access-Control-Allow-Origin', 'https://10.50.50.2:8000')

    return response

if __name__ == '__main__':
    print('starting subprocesses')
    subprocess.run(['fuser', '-k', '8002/tcp'])
    restart_subprocesses()
    
    # Start the liveness check thread
    liveness_thread = threading.Thread(target=liveness_check, daemon=True)
    liveness_thread.start()
    
    print('starting flask app')
    app.run(port=8002, host="10.50.50.2", ssl_context=("cert/cert.pem", "cert/key.pem"))

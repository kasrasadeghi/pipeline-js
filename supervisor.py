import subprocess
from flask import Flask, request, redirect
import threading
import time

app = Flask(__name__)

# Define the subprocesses
pipeline_proxy_process = None
simple_server_process = None

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
    global pipeline_proxy_process, simple_server_process
    return pipeline_proxy_process.poll() is None and simple_server_process.poll() is None


@app.route('/')
def index():
    with open('logs/proxy') as f:
        pipeline_proxy_logs = f.read()

    with open('logs/server') as f:
        simple_server_logs = f.read()

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
    <p>Pipeline Proxy: {'Running' if pipeline_proxy_process.poll() is None else 'Not Running'}</p>
    <p>Simple Server: {'Running' if simple_server_process.poll() is None else 'Not Running'}</p>
    {subprocess.run(['fuser', '8000/tcp'], capture_output=True, text=True)}
    {subprocess.run(['fuser', '8001/tcp'], capture_output=True, text=True)}
    <form action="/restart" method="post">
        <input type="submit" value="Restart Subprocesses">
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


if __name__ == '__main__':
    print('starting subprocesses')
    subprocess.run(['fuser', '-k', '8002/tcp'])
    restart_subprocesses()
    print('starting flask app')
    app.run(port=8002, host="10.50.50.2", ssl_context=("cert/cert.pem", "cert/key.pem"))

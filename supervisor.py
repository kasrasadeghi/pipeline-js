import subprocess
from flask import Flask, request, redirect, jsonify, make_response
import threading
import time
import datetime
import argparse

argparser = argparse.ArgumentParser()
argparser.add_argument('--application-port', type=str, default="8000")
argparser.add_argument('--proxy-port', type=str, default="8001")
argparser.add_argument('--supervisor-port', type=str, default="8002")
argparser.add_argument('--host', type=str)
args = argparser.parse_args()

if args.host is None:
    wireguard_addr = subprocess.check_output('ip -br addr show type wireguard', shell=True, text=True)
    assert len(wireguard_addr.strip().split("\n")) == 1, (
        "cannot automatically determine host address of wireguard interface, as more than one exists:\n" +
        f" $ ip -br addr show type wireguard\n{wireguard_addr}\n" +
        "\n" +
        "run `sudo systemctl disable wg-quick@[interface]` and `sudo systemctl stop wg-quick@[interface]` to disable one of them\n"
    )
    assert len(wireguard_addr.split()) == 3
    assert wireguard_addr.split()[2].endswith('/24') or wireguard_addr.split()[2].endswith('/32'), (wireguard_addr.split()[2] + " does not end with /24 or /32")
    # [wgname, 'UNKNOWN', 10.56.78.1/24]
    args.host = wireguard_addr.split()[2].split('/')[0]


escape = lambda x: x.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

app = Flask(__name__)

# Define the subprocesses
pipeline_proxy_process = None
simple_server_process = None

pipeline_proxy_command = ['./pipeline-proxy', args.application_port]
simple_server_command = ['python', 'simple_server.py', '--port', args.proxy_port]
simple_server_direct_command = ['python', 'simple_server.py', '--port', args.application_port]

# Global variables
last_alive_time = {
    'pipeline_proxy': None,
    'simple_server': None
}
autorestart_enabled = {
    'pipeline_proxy': False,
    'simple_server': False
}
is_proxied_mode = False

def start_subprocesses():
    global pipeline_proxy_process, simple_server_process, is_proxied_mode

    if is_proxied_mode:
        # Start the proxy with prlimit to enable coredump logging
        pipeline_proxy_process = subprocess.Popen(pipeline_proxy_command, stdout=open('logs/proxy', 'w'), stderr=subprocess.STDOUT)
        # Start simple_server on port 8001
        simple_server_process = subprocess.Popen(simple_server_command, stdout=open('logs/server', 'w'), stderr=subprocess.STDOUT)
    else:
        # Start simple_server directly on port 8000
        simple_server_process = subprocess.Popen(simple_server_direct_command, stdout=open('logs/server', 'w'), stderr=subprocess.STDOUT)

def stop_subprocesses():
    global pipeline_proxy_process, simple_server_process
    if pipeline_proxy_process is not None:
        pipeline_proxy_process.terminate()
    if simple_server_process is not None:
        simple_server_process.terminate()

    # Use fuser -k to kill 8000/tcp and 8001/tcp
    subprocess.run(['fuser', '-k', args.application_port + '/tcp'])
    subprocess.run(['fuser', '-k', args.proxy_port + '/tcp'])

def restart_subprocesses():
    stop_subprocesses()
    start_subprocesses()

def check_subprocesses():
    global pipeline_proxy_process, simple_server_process, last_alive_time, is_proxied_mode
    
    if is_proxied_mode:
        proxy_alive = pipeline_proxy_process.poll() is None if pipeline_proxy_process else False
        server_alive = simple_server_process.poll() is None if simple_server_process else False
        
        if proxy_alive:
            last_alive_time['pipeline_proxy'] = datetime.datetime.now()
        if server_alive:
            last_alive_time['simple_server'] = datetime.datetime.now()
        
        return {'pipeline_proxy': (proxy_alive, pipeline_proxy_process), 'simple_server': (server_alive, simple_server_process)}
    else:
        server_alive = simple_server_process.poll() is None if simple_server_process else False
        
        if server_alive:
            last_alive_time['simple_server'] = datetime.datetime.now()
        
        return {'simple_server': (server_alive, simple_server_process)}

def restart_process(process_name):
    global pipeline_proxy_process, simple_server_process, is_proxied_mode
    
    if is_proxied_mode:
        if process_name == 'pipeline_proxy':
            if pipeline_proxy_process is not None:
                pipeline_proxy_process.terminate()
            subprocess.run(['fuser', '-k', args.application_port + '/tcp'])
            pipeline_proxy_process = subprocess.Popen(pipeline_proxy_command, stdout=open('logs/proxy', 'w'), stderr=subprocess.STDOUT)
        elif process_name == 'simple_server':
            if simple_server_process is not None:
                simple_server_process.terminate()
            subprocess.run(['fuser', '-k', args.proxy_port + '/tcp'])
            simple_server_process = subprocess.Popen(simple_server_command, stdout=open('logs/server', 'w'), stderr=subprocess.STDOUT)
    else:
        if process_name == 'simple_server':
            if simple_server_process is not None:
                simple_server_process.terminate()
            subprocess.run(['fuser', '-k', args.application_port + '/tcp'])
            simple_server_process = subprocess.Popen(simple_server_direct_command, stdout=open('logs/server', 'w'), stderr=subprocess.STDOUT)

def liveness_check():
    global autorestart_enabled
    while True:
        subprocess_status = check_subprocesses()
        for process_name, (is_alive, process_obj) in subprocess_status.items():
            if not is_alive and autorestart_enabled[process_name]:
                restart_process(process_name)
        time.sleep(60)  # Wait for 1 minute before next check

def tail(f, n):
    return subprocess.check_output(['tail', '-n', str(n), f], text=True)
    
@app.route('/')
def index():
    with open('logs/server', 'rb') as f:
        server_log_bytecount = len(f.read())
    simple_server_logs = f"{server_log_bytecount / 1024:.4} kilobytes in logs/server\n\n" + tail('logs/server', 1000)

    pipeline_proxy_logs = None
    if is_proxied_mode:
        with open('logs/proxy') as f:
            pipeline_proxy_logs = f.read()

    subprocess_status = check_subprocesses()
    
    status_html = ""
    for process_name, (is_alive, process_obj) in subprocess_status.items():
        status = 'Running' if is_alive else 'Not Running'
        last_alive = last_alive_time[process_name].strftime('%Y-%m-%d %H:%M:%S') if last_alive_time[process_name] else 'Never'
        status_html += f"<p>{process_name.replace('_', ' ').title()}: {status} (Last alive: {last_alive}) (Process: {escape(str(process_obj))})</p>"

    if is_proxied_mode:
        # parse the logs to sort the lines by timestamp
        proxy_log_lines = map(lambda x: {'line': x, 'from': 'proxy'}, pipeline_proxy_logs.splitlines())
        server_log_lines = map(lambda x: {'line': x, 'from': 'server'}, simple_server_logs.splitlines())
        lines = list(proxy_log_lines) + list(server_log_lines)
        lines.sort(key=lambda x: " ".join(x['line'].split(' ', 2)[:2]))
        lines = [f"<span style='color: {'green' if x['from'] == 'proxy' else 'blue'}'>{x['line']}</span>" for x in lines]
        log_output = "\n".join(lines)
    else:
        log_output = "<span style='color: blue'>" + simple_server_logs + "</span>"

    return f"""
    <h1>Subprocesses Status</h1>
    <p>Current Mode: {'Proxied' if is_proxied_mode else 'Non-Proxied'}</p>
    {status_html}
    {subprocess.run(['fuser', args.application_port + '/tcp'], capture_output=True, text=True)}
    {subprocess.run(['fuser', args.proxy_port + '/tcp'], capture_output=True, text=True)}
    <form action="/restart" method="post">
        <input type="submit" value="Restart All Subprocesses">
    </form>
    
    <form action="/toggle_mode" method="post">
        <input type="submit" value="Toggle Proxied/Non-Proxied Mode">
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
    <div>
        <pre>{log_output}</pre>
    </div>
    """

@app.route('/restart', methods=['GET', 'POST'])
def restart():
    restart_subprocesses()
    return redirect('/')

@app.route('/toggle_mode', methods=['POST'])
def toggle_mode():
    global is_proxied_mode
    is_proxied_mode = not is_proxied_mode
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

    # Add CORS header from origin args.host:8000
    response = make_response(jsonify({"proxy": subprocess_status.get('pipeline_proxy', (False, None))[0], 'server': subprocess_status['simple_server'][0]}))
    response.headers.add('Access-Control-Allow-Origin', f'https://{args.host}:' + args.application_port)

    return response

if __name__ == '__main__':
    print('starting subprocesses')
    subprocess.run(['fuser', '-k', args.supervisor_port + '/tcp'])
    restart_subprocesses()
    
    # Start the liveness check thread
    liveness_thread = threading.Thread(target=liveness_check, daemon=True)
    liveness_thread.start()
    
    print('starting flask app')
    app.run(port=int(args.supervisor_port), host=args.host, ssl_context=("cert/cert.pem", "cert/key.pem"))

import os
import subprocess
import time
import sys
from datetime import datetime

def get_pipeline_url():
    return "https://127.0.0.1:8100"

def el_id(page, id):
    """
    Playwright-compatible function to find an element by ID.
    Returns a locator that can be used with .fill(), .click(), etc.
    """
    return page.locator(f"#{id}")

class Server:
    """
    Manages the server process and log file.
    The server should be able to be restarted after being stopped.
    """
    def __init__(self, port):
        self.port = port
        self.process = None
        self.log_file = None
        self.log_file_path = None
    
    def create_folders(self):
        assert os.getcwd().rsplit("/", 1)[-1] == "testing", "Current working directory is not 'testing', it's " + os.getcwd()
        
        if not os.path.exists('notes'):
            os.makedirs('notes')
            print("Created local 'notes' directory.")

        # Create logs directory if it doesn't exist
        if not os.path.exists('logs'):
            os.makedirs('logs')
            print("Created 'logs' directory.")

        # Create cert directory if it doesn't exist
        if not os.path.exists('cert'):
            os.makedirs('cert')
            print("Created 'cert' directory.")

        # Generate certificates if they don't exist
        cert_file = 'cert/cert.pem'
        key_file = 'cert/key.pem'
        if not os.path.exists(cert_file) or not os.path.exists(key_file):
            print("Generating SSL certificates...")
            subprocess.run([
                sys.executable, '../gen-certs.py', '--server-ip', '127.0.0.1'
            ], cwd='.', check=True)
            print("SSL certificates generated.")

        # Create a log file with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.log_file_path = f'logs/server_{timestamp}.log'

    def run(self):
        assert self.log_file_path is not None, "Log file is not initialized"
        self.log_file = open(self.log_file_path, 'w')
        assert self.process is None, "Server is already running"
        self.process = subprocess.Popen(
            ['python', 'simple_server.py', '--port', str(self.port), '--notes-root', 'testing/notes', '--cert-folder', 'testing/cert'],
            cwd='..',  # Set working directory to parent where assets are located
            stdout=self.log_file,
            stderr=subprocess.STDOUT,
            text=True,
        )
        time.sleep(1)  # give it a second to start
    
    def terminate(self):
        if self.process:
            self.process.terminate()
            self.process.wait()
            self.process = None
        if self.log_file:
            self.log_file.close()
            self.log_file = None
    
    def check(self):
        max_retries = 5
        retry_delay = 1  # seconds
        
        for i in range(max_retries):
            try:
                result = subprocess.run(
                    ['curl', '-k', f'https://127.0.0.1:{self.port}'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0:
                    print("Server is responding")
                    return True
            except subprocess.TimeoutExpired:
                pass
            
            if i < max_retries - 1:
                print(f"Server not ready, retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
        
        print("Server failed to respond after multiple attempts")
        return False
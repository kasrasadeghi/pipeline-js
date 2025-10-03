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
        # Allow running from either 'testing' or 'testing/visual' directory
        cwd = os.getcwd()
        is_testing_dir = cwd.endswith("testing") or cwd.endswith("testing/visual")
        assert is_testing_dir, f"Current working directory must be 'testing' or 'testing/visual', it's {cwd}"
        
        # Determine the testing directory path
        if cwd.endswith("testing/visual"):
            testing_dir = ".."
        else:
            testing_dir = "."
        
        os.makedirs(os.path.join(testing_dir, 'notes'), exist_ok=True)
        os.makedirs(os.path.join(testing_dir, 'logs'), exist_ok=True)
        os.makedirs(os.path.join(testing_dir, 'cert'), exist_ok=True)

        # Generate certificates if they don't exist
        cert_file = os.path.join(testing_dir, 'cert/cert.pem')
        key_file = os.path.join(testing_dir, 'cert/key.pem')
        if not os.path.exists(cert_file) or not os.path.exists(key_file):
            print("Generating SSL certificates...")
            subprocess.run([
                sys.executable, '../gen-certs.py', '--server-ip', '127.0.0.1'
            ], cwd=testing_dir, check=True)
            print("SSL certificates generated.")

        # Create a log file with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.log_file_path = os.path.join(testing_dir, f'logs/server_{timestamp}.log')

    def run(self):
        assert self.log_file_path is not None, "Log file is not initialized"
        self.log_file = open(self.log_file_path, 'w')
        assert self.process is None, "Server is already running"
        
        # Determine the correct working directory and paths based on where we're running from
        cwd = os.getcwd()
        working_dir = '../..' if cwd.endswith("testing/visual") else '..'
        notes_root = 'testing/notes'
        cert_folder = 'testing/cert'
        
        self.process = subprocess.Popen(
            ['python', 'simple_server.py', '--port', str(self.port), '--notes-root', notes_root, '--cert-folder', cert_folder],
            cwd=working_dir,  # Set working directory to parent where assets are located
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
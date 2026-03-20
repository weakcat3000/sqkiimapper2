import subprocess
import json
import time
import sys

# Ensure UTF-8 for output
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

command = [
    'npx.cmd', '-y', 'mcp-remote@0.1.38', 
    'https://mcp.zapier.com/api/v1/connect?token=MTczNjE2MWMtMTIxZC00ZTA0LTkzMzUtZjRkMGNhZTkxMzcyOkdDY2RRY2hCMU1YQlVxRTdpV0t2SUhVT0FVSjNzOTBrOHc5VDE1L2pKbm89'
]

tool_call = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "microsoft_outlook_find_emails",
        "arguments": {
            "instructions": "Get my very latest email",
            "output_hint": "id, subject, from, body, receivedDateTime",
            "searchValue": ""
        }
    }
}

print("Starting bridge...")
process = subprocess.Popen(
    command, 
    stdin=subprocess.PIPE, 
    stdout=subprocess.PIPE, 
    stderr=subprocess.STDOUT, 
    text=True, 
    bufsize=1,
    encoding='utf-8',
    errors='replace'
)

# Wait for bridge to connect
time.sleep(15)

# Send command
print("Sending tool call...")
process.stdin.write(json.dumps(tool_call) + "\n")
process.stdin.flush()

# Keep reading and write to file IMMEDIATELY
print("Reading output...")
start_time = time.time()
with open("final_email_raw.txt", "w", encoding='utf-8') as f:
    while time.time() - start_time < 60:
        line = process.stdout.readline()
        if line:
            f.write(line)
            f.flush()
            try:
                print(line.strip())
            except:
                print("[Non-printable line]")
            if '"result":' in line:
                print("--- RESULT DETECTED ---")
        else:
            time.sleep(0.1)

process.terminate()
print("Done.")

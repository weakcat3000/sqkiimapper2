import subprocess
import json
import time
import sys

command = [
    'npx.cmd', '-y', 'mcp-remote@0.1.38', 
    'https://mcp.zapier.com/api/v1/connect?token=MTczNjE2MWMtMTIxZC00ZTA0LTkzMzUtZjRkMGNhZTkxMzcyOkdDY2RRY2hCMU1YQlVxRTdpV0t2SUhVT0FVSjNzOTBrOHc5VDE1L2pKbm89'
]

# Run bridge and pipe EVERYTHING
process = subprocess.Popen(
    command, 
    stdin=subprocess.PIPE, 
    stdout=subprocess.PIPE, 
    stderr=subprocess.STDOUT, 
    text=True, 
    bufsize=1
)

# Connect
time.sleep(15)

# Tool call
tool_call = {
    "jsonrpc": "2.0",
    "id": 100,
    "method": "tools/call",
    "params": {
        "name": "microsoft_outlook_find_emails",
        "arguments": {
            "instructions": "find my latest email",
            "output_hint": "from, subject, body, date",
            "searchValue": ""
        }
    }
}

print("SENDING_COMMAND")
process.stdin.write(json.dumps(tool_call) + "\n")
process.stdin.flush()

# Read output line by line for 30 seconds
start_time = time.time()
while time.time() - start_time < 40:
    line = process.stdout.readline()
    if line:
        print(f"BRIDGE_OUT: {line.strip()}")
        if "result" in line.lower():
            print("FOUND_RESULT_IN_LINE")
    else:
        time.sleep(1)

process.terminate()

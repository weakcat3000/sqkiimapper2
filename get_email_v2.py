import subprocess
import json
import time
import os

command = [
    'npx.cmd', '-y', 'mcp-remote@0.1.38', 
    'https://mcp.zapier.com/api/v1/connect?token=MTczNjE2MWMtMTIxZC00ZTA0LTkzMzUtZjRkMGNhZTkxMzcyOkdDY2RRY2hCMU1YQlVxRTdpV0t2SUhVT0FVSjNzOTBrOHc5VDE1L2pKbm89'
]

# Write the command to a file to be safe
with open("call.json", "w") as f:
    f.write(json.dumps({
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
    }) + "\n")

print("Starting bridge...")
process = subprocess.Popen(
    command, 
    stdin=subprocess.PIPE, 
    stdout=subprocess.PIPE, 
    stderr=subprocess.STDOUT, 
    text=True, 
    bufsize=1
)

# Wait for bridge to connect
print("Waiting for connection...")
time.sleep(15)

# Send command
print("Sending tool call...")
with open("call.json", "r") as f:
    process.stdin.write(f.read())
    process.stdin.flush()

# Keep reading for 60 seconds or until we see the result
print("Reading output...")
all_output = []
start_time = time.time()
while time.time() - start_time < 60:
    line = process.stdout.readline()
    if line:
        all_output.append(line)
        print(line.strip())
        if '"result":' in line:
            print("--- RESULT DETECTED ---")
    else:
        time.sleep(0.1)

process.terminate()

with open("final_email_raw.txt", "w", encoding='utf-8') as f:
    f.write("".join(all_output))

print(f"Done. Captured {len(all_output)} lines.")

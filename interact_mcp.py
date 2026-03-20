import subprocess
import json
import time
import threading

command = [
    'npx.cmd', '-y', 'mcp-remote@0.1.38', 
    'https://mcp.zapier.com/api/v1/connect?token=MTczNjE2MWMtMTIxZC00ZTA0LTkzMzUtZjRkMGNhZTkxMzcyOkdDY2RRY2hCMU1YQlVxRTdpV0t2SUhVT0FVSjNzOTBrOHc5VDE1L2pKbm89'
]

process = subprocess.Popen(
    command, 
    stdin=subprocess.PIPE, 
    stdout=subprocess.PIPE, 
    stderr=subprocess.PIPE, 
    text=True, 
    bufsize=1
)

print("Waiting for connection...")
time.sleep(15)

output_buffer = []

def read_output():
    while True:
        line = process.stdout.readline()
        if not line: break
        output_buffer.append(line)
        if "tools/list" in line or "result" in line:
            with open("mcp_output.json", "a") as f:
                f.write(line + "\n")

thread = threading.Thread(target=read_output)
thread.daemon = True
thread.start()

print("Requesting tool list...")
tools_request = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}) + "\n"
process.stdin.write(tools_request)
process.stdin.flush()

time.sleep(10)
process.terminate()

with open("mcp_output.json", "w") as f:
    f.write("".join(output_buffer))
print("Output written to mcp_output.json")

"""
GuruFocus API - BKNG Valuation Scanner
"""
import urllib.request
import json
import sys

API_KEY = "gfa_QHX9oCb1E8TGv8TG5SN7Dov0wy4GxvCN"
BASE = "https://api.gurufocus.com/data"

def api_get(endpoint):
    url = f"{BASE}/{endpoint}"
    req = urllib.request.Request(url, headers={"Authorization": API_KEY})
    try:
        res = urllib.request.urlopen(req)
        return json.loads(res.read().decode())
    except Exception as e:
        return {"error": str(e)}

# Step 1: Find BKNG in stock list
print("="*60)
print("STEP 1: Searching for BKNG in stock list...")
print("="*60)
for page in range(1, 300):
    data = api_get(f"stocks/U?page={page}&per_page=100")
    entries = data.get("data", [])
    if not entries:
        print(f"  No more data at page {page}")
        break
    for s in entries:
        if "BKNG" in s.get("symbol", ""):
            print(f"  FOUND: {json.dumps(s, indent=2)}")
            stock_id = s.get("stockid", "")
            symbol = s.get("symbol", "")
            print(f"\n  stockid={stock_id}, symbol={symbol}")
            
            # Step 2: Try various endpoints with the found identifiers
            print("\n" + "="*60)
            print("STEP 2: Probing endpoints for BKNG data...")
            print("="*60)
            
            identifiers = [symbol, stock_id, f"NAS:{symbol}", f"NASDAQ:{symbol}"]
            endpoints = ["summary", "valuation", "quote", "keyratios", "financials", "profile"]
            
            for ident in identifiers:
                for ep in endpoints:
                    result = api_get(f"stock/{ident}/{ep}")
                    has_data = result and result != {} and "error" not in result
                    status = "HAS DATA" if has_data else "empty/error"
                    print(f"  stock/{ident}/{ep} -> {status}")
                    if has_data:
                        print(f"    {json.dumps(result, indent=2)[:500]}")
            
            sys.exit(0)

print("BKNG not found in entire stock list!")

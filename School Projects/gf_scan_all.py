"""
GuruFocus API - Exhaustive endpoint scan to find what returns data
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
        data = json.loads(res.read().decode())
        return data
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code}
    except Exception as e:
        return {"_error": str(e)}

def is_nonempty(data):
    if data is None:
        return False
    if isinstance(data, dict):
        if "_http_error" in data or "_error" in data:
            return False
        if data == {}:
            return False
        # Check if it has "data" key with empty list
        if data.get("data") == [] and data.get("total", 0) == 0:
            return False
        return True
    if isinstance(data, list):
        return len(data) > 0
    return True

# ============================================================
# CATEGORY 1: Stock list endpoints (we know these work)
# ============================================================
print("=" * 70)
print("CATEGORY 1: Stock List Endpoints")
print("=" * 70)

stock_list_endpoints = [
    "stocks/U?page=1&per_page=3",      # US stocks
    "stocks/HKG?page=1&per_page=3",    # Hong Kong
    "stocks/SHE?page=1&per_page=3",    # Shenzhen
    "stocks/SHA?page=1&per_page=3",    # Shanghai
    "stocks/LON?page=1&per_page=3",    # London
    "stocks/TSE?page=1&per_page=3",    # Toronto
    "stocks/ASX?page=1&per_page=3",    # Australia
    "stocks/FRA?page=1&per_page=3",    # Frankfurt
]

for ep in stock_list_endpoints:
    data = api_get(ep)
    status = "✓ DATA" if is_nonempty(data) else "✗ empty"
    count = data.get("total", "?") if isinstance(data, dict) else "?"
    print(f"  {status}  {ep}  (total: {count})")

# ============================================================
# CATEGORY 2: Individual stock data (using BKNG and AAPL)
# ============================================================
print("\n" + "=" * 70)
print("CATEGORY 2: Individual Stock Data (BKNG & AAPL)")
print("=" * 70)

stock_endpoints = [
    "summary", "profile", "quote", "valuation", "keyratios",
    "financials", "ratios", "price", "indicators", "dividend",
    "dividends", "segments", "ranking", "rankings", "score",
    "gurus", "insiders", "news", "analyst", "estimates",
    "ownership", "peers", "chart", "history", "real_time",
]

for symbol in ["BKNG", "AAPL"]:
    print(f"\n  --- {symbol} ---")
    for ep in stock_endpoints:
        data = api_get(f"stock/{symbol}/{ep}")
        nonempty = is_nonempty(data)
        status = "✓ DATA" if nonempty else "✗ empty"
        preview = ""
        if nonempty:
            preview = f"  → {json.dumps(data)[:120]}..."
        print(f"    {status}  stock/{symbol}/{ep}{preview}")

# ============================================================
# CATEGORY 3: Guru/Insider/ETF endpoints
# ============================================================
print("\n" + "=" * 70)
print("CATEGORY 3: Guru, Insider, ETF, Screener Endpoints")
print("=" * 70)

misc_endpoints = [
    "gurus?page=1&per_page=3",
    "gurus/list?page=1&per_page=3",
    "insiders?page=1&per_page=3",
    "insiders/list?page=1&per_page=3",
    "etfs?page=1&per_page=3",
    "etfs/list?page=1&per_page=3",
    "screener",
    "screener/stocks",
    "indices",
    "markets",
    "sectors",
    "industries",
    "exchanges",
]

for ep in misc_endpoints:
    data = api_get(ep)
    nonempty = is_nonempty(data)
    status = "✓ DATA" if nonempty else "✗ empty"
    preview = ""
    if nonempty:
        preview = f"  → {json.dumps(data)[:120]}..."
    err = ""
    if isinstance(data, dict) and "_http_error" in data:
        err = f"  (HTTP {data['_http_error']})"
    print(f"  {status}  {ep}{preview}{err}")

# ============================================================
# CATEGORY 4: Stocks sub-endpoints (plural)
# ============================================================
print("\n" + "=" * 70)
print("CATEGORY 4: Stocks (plural) sub-endpoints")
print("=" * 70)

plural_endpoints = [
    "stocks/valuations/BKNG",
    "stocks/financials/BKNG",
    "stocks/ratios/BKNG",
    "stocks/summary/BKNG",
    "stocks/profile/BKNG",
    "stocks/quote/BKNG",
    "stocks/BKNG",
    "stocks/search/BKNG",
    "stocks/search?q=BKNG",
    "stocks/lookup/BKNG",
    "stocks/lookup?q=BKNG",
]

for ep in plural_endpoints:
    data = api_get(ep)
    nonempty = is_nonempty(data)
    status = "✓ DATA" if nonempty else "✗ empty"
    preview = ""
    if nonempty:
        preview = f"  → {json.dumps(data)[:120]}..."
    err = ""
    if isinstance(data, dict) and "_http_error" in data:
        err = f"  (HTTP {data['_http_error']})"
    print(f"  {status}  {ep}{preview}{err}")

print("\n" + "=" * 70)
print("SCAN COMPLETE")
print("=" * 70)

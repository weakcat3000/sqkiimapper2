import json

from Other_Alerts import warmup_great_gold_hunt_session


def main():
    payload = warmup_great_gold_hunt_session()
    print(f"WARMUP_OK {len(payload)}")
    print(json.dumps(payload[:3], ensure_ascii=False))


if __name__ == "__main__":
    main()

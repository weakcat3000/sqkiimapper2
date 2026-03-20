"""Send a one-off Telegram broadcast, optionally after a delay."""

import argparse
import time

import ai_assistant
import config as cfg
from telegram_bot import send_telegram_message


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--delay", type=int, default=0, help="Delay in seconds before sending")
    parser.add_argument("--chat-id", default=cfg.AI_BROADCAST_CHAT_ID, help="Telegram chat id")
    parser.add_argument("--text", default="", help="Explicit message text")
    parser.add_argument("--provider", default="gemini-fast", help="AI provider for generated message")
    args = parser.parse_args()

    if not args.chat_id:
        raise SystemExit("Missing chat id. Set AI_BROADCAST_CHAT_ID or pass --chat-id.")

    if args.delay > 0:
        time.sleep(args.delay)

    text = args.text.strip() if args.text else ai_assistant.generate_group_broadcast(provider=args.provider)
    send_telegram_message(text, chat_id=args.chat_id)


if __name__ == "__main__":
    main()

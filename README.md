# Crypto Wallet Confluence Detection Bot

This bot analyzes data from a Telegram wallet tracker to detect when multiple wallets buy or sell the same cryptocurrency within a given time period (confluence).

## Features

- Monitors wallet tracker messages in Telegram
- Detects cryptocurrency buys and sells
- Identifies confluences (multiple wallets buying/selling the same coin)
- Sends alerts via Telegram when a confluence is detected
- Automatically cleans old transactions

## Installation

1. Clone this repository or download the files
2. Install dependencies with `npm install`
3. Create a `.env` file in the project root and configure the following variables:
   ```
   BOT_TOKEN=your_telegram_bot_token
   MIN_WALLETS_FOR_CONFLUENCE=2
   CONFLUENCE_WINDOW_MINUTES=60
   LOG_LEVEL=info
   ```
4. Start the bot with `npm start` or `npm run dev` for development mode

## Configuration

- `BOT_TOKEN`: Your Telegram bot token (obtained from @BotFather)
- `MIN_WALLETS_FOR_CONFLUENCE`: Minimum number of different wallets required to consider a confluence
- `CONFLUENCE_WINDOW_MINUTES`: Time window (in minutes) to consider transactions as part of the same confluence
- `LOG_LEVEL`: Log level (debug, info, warn, error)

## Bot Commands

- `/start` - Activate the bot in a chat and start monitoring for confluences
- `/stop` - Deactivate the bot in a chat

## Adapting the Parser

The parserService.js file will need to be adapted based on the exact format of your wallet tracker messages. Once you share examples of the messages, we can implement the appropriate parsing logic.

## Contributing

Feel free to open issues or submit pull requests to improve this project.
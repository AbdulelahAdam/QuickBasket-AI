# QuickBasket AI - Smart Price Tracker

Track prices across Amazon, Noon, and other marketplaces with AI-powered insights.

## Features

- Automatic price tracking across multiple marketplaces
- AI-powered buy/wait recommendations
- Price history visualization with interactive charts
- Real-time price drop alerts
- Track up to 50 products simultaneously
- Support for Amazon (all regions) and Noon

## Installation

### 1. Download

Download the latest release from the [Releases page](https://github.com/AbdulelahAdam/quickbasket-ai/releases) or clone the repository:

```bash
git clone https://github.com/AbdulelahAdam/quickbasket-ai.git
cd quickbasket-ai
```

### 2. Install Extension

1. Open your Chromium-based browser (Chrome, Edge, Brave, etc.)
2. Navigate to extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `extension` folder from this repository
6. The QuickBasket AI icon should appear in your toolbar

### 3. Start Using

1. Click the QuickBasket AI icon in your toolbar
2. Create an account or log in
3. Navigate to any product page on Amazon or Noon
4. Click the extension icon and press "Track This Product"
5. View your dashboard to see price history and AI insights

## Supported Marketplaces

- Amazon (all regions: .com, .ae, .eg, .sa, .uk, .de, .fr, .it, .es, .ca, .in, .co.jp)
- Noon (.com)
- More soon...

## Usage

### Tracking a Product

1. Go to a product page on a supported marketplace
2. Click the QuickBasket AI extension icon
3. Click "Track This Product"
4. The extension will automatically monitor the price

### Viewing Your Dashboard

- Click the extension icon
- Click "View Dashboard"
- See all tracked products, price trends, and savings

### Setting Update Intervals

In the dashboard, each product has an interval dropdown:

- 1 hour - For time-sensitive deals
- 6 hours - Balanced tracking
- 12 hours - Less frequent updates
- 24 hours - Daily checks (default)

## Troubleshooting

### Extension doesn't appear in toolbar

- Go to your browser's extensions page
- Find "QuickBasket AI" and ensure it's enabled
- Click the puzzle icon in toolbar and pin the extension

### "Not on a supported marketplace" error

- Ensure you're on a product page, not a search results page
- Verify the URL contains a product identifier (ASIN for Amazon, SKU for Noon)

### Products not updating

- Check the "Next Snapshot" timer in the dashboard
- The extension must remain installed for automatic updates
- Updates happen in the background while your browser is open

### Login issues

- Clear browser cache and try again
- Ensure you have a stable internet connection
- Check for any browser extensions that might block requests

## Privacy & Security

- Your email and password are encrypted using industry-standard practices
- Price data is stored securely and never shared with third parties
- The extension only accesses product pages you explicitly track
- No browsing history or personal data is collected outside of tracked products

## Permissions Explained

The extension requires these permissions:

- **Storage** - Save your tracked products locally
- **Tabs** - Detect when you're on a supported product page
- **Active Tab** - Extract product information from the current page
- **Alarms** - Schedule automatic price checks
- **Notifications** - Alert you about price drops
- **Host Permissions** - Access Amazon and Noon to check prices

## Uninstallation

To completely remove QuickBasket AI:

1. Go to your browser's extensions page
2. Find "QuickBasket AI"
3. Click "Remove"
4. Your account data will be permanently deleted after 30 days of inactivity

## Limits

- Maximum 50 tracked products per account
- Price checks run at your selected interval (1h, 6h, 12h, or 24h)
- Price history stored for 120 days

## Support

- Report bugs: [GitHub Issues](https://github.com/AbdulelahAdam/quickbasket-ai/issues)
- Feature requests: [GitHub Discussions](https://github.com/AbdulelahAdam/quickbasket-ai/discussions)

## License

MIT License - see LICENSE file for details

---

Made by Abdulelah Adam.

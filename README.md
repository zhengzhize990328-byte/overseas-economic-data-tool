# Market Atlas — Overseas Economic Data Tool

This is a dependency-free browser SPA for exchange rates, GDP per capita, PPP GDP per capita and country comparison. The source directory was empty when implementation started, so the app uses a small static ES-module architecture that can be served by any static web server.

## Run locally

    npm run dev

Then open http://localhost:4173.

The app requests live data in the browser:

- World Bank World Development Indicators: NY.GDP.PCAP.CD and NY.GDP.PCAP.PP.CD
- Frankfurter / ECB for daily FX when available
- ExchangeRate API as a latest-rate fallback
- World Bank PA.NUS.FCRF as an annual historical FX fallback for supported currencies

Successful responses are cached in localStorage (FX latest: 15 minutes; FX history: 6 hours; economic data: 24 hours). Missing observations stay empty and are rendered as —; there is no zero-fill or interpolation.

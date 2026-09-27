# Market Atlas — Overseas Economic Data Tool

This is a dependency-free browser SPA for exchange rates, GDP per capita, PPP GDP per capita and country comparison. The source directory was empty when implementation started, so the app uses a small static ES-module architecture that can be served by any static web server.

## Run locally

    npm run dev

Then open http://localhost:4173.

The app requests live data in the browser:

- World Bank World Development Indicators: NY.GDP.PCAP.CD and NY.GDP.PCAP.PP.CD
- Frankfurter v2 for the complete API currency catalogue, current rates and daily FX history
- Frankfurter monthly observations for the MAX historical range
- World Bank PA.NUS.FCRF as an annual-average cross-rate fallback for supported currencies when the 5Y / 10Y / MAX request fails; annual rates never substitute for a current rate

Successful responses are cached in localStorage (FX latest: 15 minutes; FX history: 6 hours; currency catalogue and economic data: 24 hours). Missing observations stay empty and are rendered as —; there is no zero-fill or interpolation. Availability varies by currency pair and date. The interface shows the actual coverage and observation count.

Chinese is the default language; the language switch preserves the user's choice. Currency search accepts Chinese or English country/currency names, exact codes and approximate English spelling. Country details expand immediately below the selected row. GDP and PPP keep their own observation years; PPP / GDP is calculated only for matching years. Only World Bank historical observations are used for economics; no IMF forecast is included.

## Verification

    npm test

The service regression suite covers missing values, cache behavior, request de-duplication, error retry, date boundaries, monthly MAX history, annual fallback and same-currency conversion.

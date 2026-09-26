const WB_BASE = "https://api.worldbank.org/v2";
const FX_BASE = "https://api.frankfurter.dev/v1";
const FALLBACK_FX = "https://open.er-api.com/v6/latest";
const CACHE_PREFIX = "market-atlas:";
const CACHE_TTL = { fx: 15 * 60 * 1000, fxHistory: 6 * 60 * 60 * 1000, gdp: 24 * 60 * 60 * 1000 };

export const CURRENCY_META = [
  ["CNY", "China", "Chinese Yuan", "¥", "CHN"], ["USD", "United States", "US Dollar", "$", "USA"], ["EUR", "Euro area", "Euro", "€", "DEU"], ["GBP", "United Kingdom", "British Pound", "£", "GBR"], ["JPY", "Japan", "Japanese Yen", "¥", "JPN"], ["NGN", "Nigeria", "Nigerian Naira", "₦", "NGA"], ["AOA", "Angola", "Angolan Kwanza", "Kz", "AGO"], ["GHS", "Ghana", "Ghanaian Cedi", "GH₵", "GHA"], ["BDT", "Bangladesh", "Bangladeshi Taka", "৳", "BGD"], ["VND", "Vietnam", "Vietnamese Dong", "₫", "VNM"], ["IDR", "Indonesia", "Indonesian Rupiah", "Rp", "IDN"], ["PHP", "Philippines", "Philippine Peso", "₱", "PHL"], ["UZS", "Uzbekistan", "Uzbekistani Som", "лв", "UZB"], ["ETB", "Ethiopia", "Ethiopian Birr", "Br", "ETH"], ["KES", "Kenya", "Kenyan Shilling", "KSh", "KEN"], ["TZS", "Tanzania", "Tanzanian Shilling", "TSh", "TZA"], ["ZAR", "South Africa", "South African Rand", "R", "ZAF"], ["INR", "India", "Indian Rupee", "₹", "IND"], ["MYR", "Malaysia", "Malaysian Ringgit", "RM", "MYS"], ["THB", "Thailand", "Thai Baht", "฿", "THA"], ["KRW", "South Korea", "South Korean Won", "₩", "KOR"], ["AUD", "Australia", "Australian Dollar", "A$", "AUS"], ["CAD", "Canada", "Canadian Dollar", "C$", "CAN"], ["CHF", "Switzerland", "Swiss Franc", "CHF", "CHE"], ["SGD", "Singapore", "Singapore Dollar", "S$", "SGP"], ["AED", "United Arab Emirates", "UAE Dirham", "د.إ", "ARE"], ["SAR", "Saudi Arabia", "Saudi Riyal", "﷼", "SAU"], ["TRY", "Türkiye", "Turkish Lira", "₺", "TUR"], ["BRL", "Brazil", "Brazilian Real", "R$", "BRA"], ["MXN", "Mexico", "Mexican Peso", "Mex$", "MEX"], ["EGP", "Egypt", "Egyptian Pound", "E£", "EGY"]
].map(function (item) { return { code: item[0], country: item[1], name: item[2], symbol: item[3], wbCode: item[4] }; });

const currencyByCode = new Map(CURRENCY_META.map(function (item) { return [item.code, item]; }));
const DEFAULT_COUNTRIES = ["CHN", "USA", "NGA", "AGO", "GHA", "BGD", "VNM", "IDN", "PHL", "UZB", "ETH", "KEN", "TZA", "ZAF", "IND", "MYS", "THA", "JPN", "KOR"];

function readCache(key, ttl) {
  try { const raw = localStorage.getItem(CACHE_PREFIX + key); if (!raw) return null; const value = JSON.parse(raw); return Date.now() - value.savedAt < ttl ? value.data : null; } catch (error) { return null; }
}
function writeCache(key, data) { try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data: data })); } catch (error) {} return data; }
async function getJson(url) { const response = await fetch(url, { headers: { Accept: "application/json" } }); if (!response.ok) throw new Error("Request failed (" + response.status + ")"); return response.json(); }

export function getCurrency(code) { return currencyByCode.get(code) || { code: code, country: code, name: code, symbol: code, wbCode: null }; }
export function getDefaultCountryCodes() { return DEFAULT_COUNTRIES.slice(); }

export async function getLatestRates(base) {
  const cacheKey = "fx-latest-" + base; const cached = readCache(cacheKey, CACHE_TTL.fx); if (cached) return cached;
  let payload;
  try {
    const data = await getJson(FX_BASE + "/latest?base=" + encodeURIComponent(base));
    payload = { base: data.base, date: data.date, rates: Object.assign({}, data.rates, { [base]: 1 }), source: "Frankfurter / ECB" };
  } catch (error) {
    const fallback = await getJson(FALLBACK_FX + "/" + encodeURIComponent(base));
    if (!fallback || fallback.result !== "success") throw new Error("The public FX sources are unavailable right now.");
    payload = { base: base, date: fallback.time_last_update_utc || new Date().toISOString(), rates: Object.assign({}, fallback.rates, { [base]: 1 }), source: "ExchangeRate API" };
  }
  return writeCache(cacheKey, payload);
}

function toIsoDate(date) { return date.toISOString().slice(0, 10); }
function rangeStart(range) { const now = new Date(); const days = { "7D": 7, "1M": 31, "3M": 92, "6M": 183, "1Y": 365, "5Y": 1825, "10Y": 3650, "MAX": 11000 }[range] || 365; now.setDate(now.getDate() - days); return toIsoDate(now); }

export async function getExchangeHistory(base, quote, range) {
  const cacheKey = "fx-history-" + base + "-" + quote + "-" + range; const cached = readCache(cacheKey, CACHE_TTL.fxHistory); if (cached) return cached;
  const start = rangeStart(range); const end = toIsoDate(new Date());
  try {
    const data = await getJson(FX_BASE + "/" + start + ".." + end + "?base=" + encodeURIComponent(base) + "&symbols=" + encodeURIComponent(quote));
    const points = Object.entries(data.rates || {}).map(function (entry) { return { date: entry[0], value: entry[1][quote] }; }).filter(function (point) { return point.value != null; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (points.length > 1) return writeCache(cacheKey, { points: points, source: "Frankfurter / ECB", frequency: "daily" });
  } catch (error) {}
  const annual = await getWorldBankExchangeHistory(base, quote, range);
  return writeCache(cacheKey, annual);
}

async function getWorldBankExchangeHistory(base, quote, range) {
  const baseMeta = getCurrency(base); const quoteMeta = getCurrency(quote);
  if (!baseMeta.wbCode || !quoteMeta.wbCode) return { points: [], source: "World Bank — annual fallback", frequency: "annual" };
  const startYear = new Date().getFullYear() - ({ "7D": 1, "1M": 1, "3M": 1, "6M": 2, "1Y": 2, "5Y": 6, "10Y": 11, "MAX": 35 }[range] || 2);
  const countries = baseMeta.wbCode + ";" + quoteMeta.wbCode;
  const json = await getJson(WB_BASE + "/country/" + countries + "/indicator/PA.NUS.FCRF?date=" + startYear + ":" + new Date().getFullYear() + "&format=json&per_page=5000");
  const rows = Array.isArray(json) ? json[1] || [] : []; const byYear = new Map();
  rows.forEach(function (row) { if (row.value == null) return; const entry = byYear.get(row.date) || {}; entry[row.countryiso3code] = Number(row.value); byYear.set(row.date, entry); });
  const points = Array.from(byYear.entries()).map(function (entry) { const basePerUsd = base === "USD" ? 1 : entry[1][baseMeta.wbCode]; const quotePerUsd = quote === "USD" ? 1 : entry[1][quoteMeta.wbCode]; return { date: entry[0], value: basePerUsd && quotePerUsd ? quotePerUsd / basePerUsd : null }; }).filter(function (point) { return point.value != null; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  return { points: points, source: "World Bank — annual fallback", frequency: "annual" };
}

async function getIndicator(indicator, startYear) { const json = await getJson(WB_BASE + "/country/all/indicator/" + indicator + "?date=" + startYear + ":" + new Date().getFullYear() + "&format=json&per_page=30000"); return Array.isArray(json) ? json[1] || [] : []; }

export async function getEconomicDataset() {
  const cached = readCache("gdp-dataset", CACHE_TTL.gdp); if (cached) return cached;
  const [countriesPayload, gdpRows, pppRows] = await Promise.all([getJson(WB_BASE + "/country?format=json&per_page=400"), getIndicator("NY.GDP.PCAP.CD", 1960), getIndicator("NY.GDP.PCAP.PP.CD", 1960)]);
  const countryRows = Array.isArray(countriesPayload) ? countriesPayload[1] || [] : [];
  const names = new Map(countryRows.filter(function (row) { return row.id && row.region && row.region.id !== "NA"; }).map(function (row) { return [row.id, { name: row.name, region: row.region.value || "" }]; }));
  const byCode = new Map(); const ensure = function (code) { if (!byCode.has(code)) { const meta = names.get(code) || {}; byCode.set(code, { countryCode: code, countryName: meta.name || code, region: meta.region || "", gdpHistory: [], pppHistory: [] }); } return byCode.get(code); };
  gdpRows.forEach(function (row) { if (!row.countryiso3code || !names.has(row.countryiso3code) || row.value == null) return; ensure(row.countryiso3code).gdpHistory.push({ year: Number(row.date), value: Number(row.value) }); });
  pppRows.forEach(function (row) { if (!row.countryiso3code || !names.has(row.countryiso3code) || row.value == null) return; ensure(row.countryiso3code).pppHistory.push({ year: Number(row.date), value: Number(row.value) }); });
  byCode.forEach(function (country) { country.gdpHistory.sort(function (a, b) { return a.year - b.year; }); country.pppHistory.sort(function (a, b) { return a.year - b.year; }); const gdpLatest = country.gdpHistory[country.gdpHistory.length - 1]; const pppLatest = country.pppHistory[country.pppHistory.length - 1]; country.latest = { gdp: gdpLatest ? gdpLatest.value : null, gdpYear: gdpLatest ? gdpLatest.year : null, ppp: pppLatest ? pppLatest.value : null, pppYear: pppLatest ? pppLatest.year : null }; });
  return writeCache("gdp-dataset", { countries: Array.from(byCode.values()), source: "World Bank — World Development Indicators", fetchedAt: new Date().toISOString() });
}

export function filterEconomicCountries(dataset, query) { const normalized = (query || "").trim().toLowerCase(); return dataset.countries.filter(function (country) { return !normalized || country.countryName.toLowerCase().includes(normalized) || country.countryCode.toLowerCase().includes(normalized); }); }

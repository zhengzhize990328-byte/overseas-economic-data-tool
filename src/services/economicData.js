import { CURRENCY_REGIONS, CURRENCY_SPECIAL_REGIONS } from "./currencyRegions.js";

const WB_BASE = "https://api.worldbank.org/v2";
const FX_BASE = "https://api.frankfurter.dev/v2";
const CACHE_PREFIX = "market-atlas:";
const CACHE_TTL = { fx: 15 * 60 * 1000, fxHistory: 6 * 60 * 60 * 1000, currencies: 24 * 60 * 60 * 1000, gdp: 24 * 60 * 60 * 1000 };

// Frankfurter v2 is the catalogue of record. getCurrencies() fills this live
// binding; it is deliberately not a bundled, limited currency list.
export const CURRENCY_META = [];
let currencyByCode = new Map();
let currenciesRequest = null;
let economicDatasetRequest = null;
const WORLD_BANK_REFERENCE_BY_CURRENCY = Object.freeze({ CNY: "CHN", USD: "USA", EUR: "DEU", GBP: "GBR", JPY: "JPN", NGN: "NGA", AOA: "AGO", GHS: "GHA", BDT: "BGD", VND: "VNM", IDR: "IDN", PHP: "PHL", UZS: "UZB", ETB: "ETH", KES: "KEN", TZS: "TZA", ZAR: "ZAF", INR: "IND", MYR: "MYS", THB: "THA" });
const CURRENCY_NAMES_ZH = Object.freeze({ CMD: "东南非共同市场元", CNH: "离岸人民币", GGP: "根西镑", IMP: "马恩岛镑", JEP: "泽西镑", MRO: "毛里塔尼亚乌吉亚", XAG: "白银（盎司）", XAU: "黄金（盎司）", XCG: "加勒比盾", XPD: "钯（盎司）", XPT: "铂金（盎司）", ZWG: "津巴布韦金" });
const DEFAULT_COUNTRIES = ["CHN", "USA", "NGA", "AGO", "GHA", "BGD", "VNM", "IDN", "PHL", "UZB", "ETH", "KEN", "TZA", "ZAF", "IND", "MYS", "THA", "JPN", "KOR"];

function readCache(key, ttl) { try { const raw = localStorage.getItem(CACHE_PREFIX + key); if (!raw) return null; const value = JSON.parse(raw); return Date.now() - value.savedAt < ttl ? value.data : null; } catch (error) { return null; } }
function writeCache(key, data) { try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data: data })); } catch (error) {} return data; }
async function getJson(url, timeoutMs) { const controller = typeof AbortController === "undefined" ? null : new AbortController(), timeout = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 12000) : null; try { const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller && controller.signal }); if (!response.ok) throw new Error("Request failed (" + response.status + ")"); return response.json(); } catch (error) { if (error && error.name === "AbortError") throw new Error("Request timed out"); throw error; } finally { if (timeout) clearTimeout(timeout); } }
function finiteEconomicValue(value) { if (typeof value !== "number" && typeof value !== "string") return null; if (typeof value === "string" && !value.trim()) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function positive(value) { const number = finiteEconomicValue(value); return number != null && number > 0 ? number : null; }
function displayName(type, code, locale, fallback) { try { const value = new Intl.DisplayNames([locale], { type: type }).of(code); return value && value !== code ? value : fallback; } catch (error) { return fallback; } }
function currencySymbol(code, fallback) { try { return new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find(function (part) { return part.type === "currency"; }).value || fallback || code; } catch (error) { return fallback || code; } }
function replaceCurrencyCache(items) { CURRENCY_META.splice.apply(CURRENCY_META, [0, CURRENCY_META.length].concat(items)); currencyByCode = new Map(items.map(function (item) { return [item.code, item]; })); }
function normalizeCurrency(row) { const code = String(row.iso_code || row.code || "").toUpperCase(), regions = (CURRENCY_REGIONS[code] || []).slice(), special = CURRENCY_SPECIAL_REGIONS[code], regionNames = regions.length ? regions.map(function (region) { return displayName("region", region, "en", region); }) : (special ? special.en.slice() : []), regionNamesZh = regions.length ? regions.map(function (region) { return displayName("region", region, "zh-CN", region); }) : (special ? special.zh.slice() : []), fallbackName = row.name || code; return { code: code, isoCode: code, isoNumeric: String(row.iso_numeric || row.numeric || ""), country: regionNames.join(" · "), countryZh: regionNamesZh.join(" · "), regions: regions, regionNames: regionNames, regionNamesZh: regionNamesZh, name: fallbackName || displayName("currency", code, "en", code), nameZh: CURRENCY_NAMES_ZH[code] || displayName("currency", code, "zh-CN", fallbackName), symbol: row.symbol || currencySymbol(code, code), wbCode: WORLD_BANK_REFERENCE_BY_CURRENCY[code] || null, countryCode: regions[0] || null, startDate: row.start_date || null, endDate: row.end_date || null, source: "Frankfurter" }; }

export function getCurrencies() {
  if (currenciesRequest) return currenciesRequest;
  currenciesRequest = (async function () {
    const cached = readCache("fx-currencies-v5", CACHE_TTL.currencies); if (cached && Array.isArray(cached)) { replaceCurrencyCache(cached); return CURRENCY_META.slice(); }
    const data = await getJson(FX_BASE + "/currencies"), normalized = (Array.isArray(data) ? data : []).map(normalizeCurrency).filter(function (item) { return item.code; }).sort(function (a, b) { return a.code.localeCompare(b.code); });
    if (!normalized.length) throw new Error("Frankfurter returned no active currencies");
    replaceCurrencyCache(normalized); return writeCache("fx-currencies-v5", normalized).slice();
  })();
  currenciesRequest.then(function () { currenciesRequest = null; }, function () { currenciesRequest = null; });
  return currenciesRequest;
}

export function getCurrency(code) { const normalized = String(code || "").toUpperCase(), regions = (CURRENCY_REGIONS[normalized] || []).slice(), special = CURRENCY_SPECIAL_REGIONS[normalized], regionNames = regions.length ? regions.map(function (region) { return displayName("region", region, "en", region); }) : (special ? special.en.slice() : []), regionNamesZh = regions.length ? regions.map(function (region) { return displayName("region", region, "zh-CN", region); }) : (special ? special.zh.slice() : []); return currencyByCode.get(normalized) || { code: normalized, isoCode: normalized, isoNumeric: "", country: regionNames.join(" · "), countryZh: regionNamesZh.join(" · "), regions: regions, regionNames: regionNames, regionNamesZh: regionNamesZh, name: displayName("currency", normalized, "en", normalized), nameZh: CURRENCY_NAMES_ZH[normalized] || displayName("currency", normalized, "zh-CN", normalized), symbol: currencySymbol(normalized, normalized), wbCode: WORLD_BANK_REFERENCE_BY_CURRENCY[normalized] || null, countryCode: regions[0] || null, source: "fallback" }; }
export function getDefaultCountryCodes() { return DEFAULT_COUNTRIES.slice(); }

export async function getLatestRates(base, quote) {
  const from = String(base || "").toUpperCase(), to = String(quote || "").toUpperCase(); if (!from || !to) throw new Error("A base and quote currency are required.");
  if (from === to) return { base: from, date: new Date().toISOString().slice(0, 10), rates: { [from]: 1 }, source: "identity" };
  const cacheKey = "fx-latest-frankfurter-v2-" + from + "-" + to, cached = readCache(cacheKey, CACHE_TTL.fx); if (cached && cached.rates && positive(cached.rates[to])) return cached;
  const data = await getJson(FX_BASE + "/rate/" + encodeURIComponent(from) + "/" + encodeURIComponent(to));
  const rate = positive(data && data.rate); if (!rate) throw new Error("No current rate is available for " + from + " → " + to + ".");
  return writeCache(cacheKey, { base: from, date: data.date || new Date().toISOString().slice(0, 10), rates: { [from]: 1, [to]: rate }, source: "Frankfurter" });
}

function toIsoDate(date) { return date.toISOString().slice(0, 10); }
function rangeStart(range) { if (range === "MAX") return "1948-01-01"; const now = new Date(), days = { "7D": 7, "1M": 31, "3M": 92, "6M": 183, "1Y": 365, "5Y": 1825, "10Y": 3650 }[range] || 365; now.setDate(now.getDate() - days); return toIsoDate(now); }
function availability(range, start, end, reason, points) { return { requestedRange: range, requestedStart: start, requestedEnd: end, pointCount: points.length, sparse: points.length < 2, reason: reason || null }; }

export async function getExchangeHistory(base, quote, range) {
  const from = String(base || "").toUpperCase(), to = String(quote || "").toUpperCase(), selectedRange = range || "1Y"; if (!from || !to) throw new Error("A base and quote currency are required.");
  const cacheKey = "fx-history-frankfurter-v3-" + from + "-" + to + "-" + selectedRange, cached = readCache(cacheKey, CACHE_TTL.fxHistory); if (cached) return cached;
  const start = rangeStart(selectedRange), end = toIsoDate(new Date());
  try {
    const group = selectedRange === "MAX" ? "month" : "";
    const data = await getJson(FX_BASE + "/rates?base=" + encodeURIComponent(from) + "&quotes=" + encodeURIComponent(to) + "&from=" + start + "&to=" + end + (group ? "&group=" + group : ""), 20000);
    if (!Array.isArray(data)) throw new Error("Frankfurter returned an invalid historical-rate payload.");
    const points = data.map(function (row) { return { date: row && row.date, value: positive(row && row.rate) }; }).filter(function (point) { return /^\d{4}-\d{2}-\d{2}$/.test(point.date || "") && point.date >= start && point.date <= end && point.value != null; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    const reason = points.length > 1 ? null : (points.length ? "Only one daily observation is available in the requested range." : "No daily observations are available in the requested range.");
    return writeCache(cacheKey, { points: points, source: "Frankfurter", frequency: group ? "monthly" : "daily", availability: availability(selectedRange, start, end, reason, points) });
  } catch (error) {
    if (!["5Y", "10Y", "MAX"].includes(selectedRange)) throw error;
    const annual = await getWorldBankExchangeHistory(from, to, selectedRange, start, end, error.message);
    return writeCache(cacheKey, annual);
  }
}

async function getWorldBankExchangeHistory(base, quote, range, start, end, sourceError) {
  const baseMeta = getCurrency(base), quoteMeta = getCurrency(quote); if (!baseMeta.wbCode || !quoteMeta.wbCode) throw new Error("Frankfurter unavailable: " + sourceError + ". No World Bank country mapping exists for this currency pair.");
  const startYear = Number(start.slice(0, 4)), endYear = Number(end.slice(0, 4));
  const json = await getJson(WB_BASE + "/country/" + baseMeta.wbCode + ";" + quoteMeta.wbCode + "/indicator/PA.NUS.FCRF?date=" + startYear + ":" + endYear + "&format=json&per_page=5000"), byYear = new Map();
  worldBankRows(json, "annual exchange-rate fallback").forEach(function (row) { const value = positive(row.value), code = String(row.countryiso3code || "").toUpperCase(); if (!value || !code) return; const entry = byYear.get(row.date) || {}; entry[code] = value; byYear.set(row.date, entry); });
  const points = Array.from(byYear.entries()).map(function (entry) { const basePerUsd = base === "USD" ? 1 : entry[1][baseMeta.wbCode], quotePerUsd = quote === "USD" ? 1 : entry[1][quoteMeta.wbCode]; return { date: entry[0], value: positive(basePerUsd) && positive(quotePerUsd) ? quotePerUsd / basePerUsd : null }; }).filter(function (point) { return point.value != null; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  if (!points.length) throw new Error("Frankfurter unavailable: " + sourceError + ". World Bank has no annual observations in the requested range.");
  return { points: points, source: "World Bank annual fallback", frequency: "annual", availability: availability(range, start, end, "Frankfurter unavailable: " + sourceError + (points.length < 2 ? ". Annual data are sparse for the requested range." : ""), points) };
}

function worldBankRows(payload, label) { if (Array.isArray(payload) && Array.isArray(payload[1])) return payload[1]; const message = payload && payload[0] && Array.isArray(payload[0].message) && payload[0].message[0] && payload[0].message[0].value; throw new Error("World Bank " + label + " payload is unavailable" + (message ? ": " + message : ".")); }
async function getIndicator(indicator, startYear) { const json = await getJson(WB_BASE + "/country/all/indicator/" + indicator + "?date=" + startYear + ":" + new Date().getFullYear() + "&format=json&per_page=30000"); return worldBankRows(json, indicator); }
function completeAnnualHistory(points) { const values = new Map(points.filter(function (point) { return Number.isFinite(point.value); }).map(function (point) { return [point.year, point.value]; })); const endYear = new Date().getFullYear(), startYear = values.size ? Math.min.apply(null, Array.from(values.keys())) : 1960; const history = []; for (let year = startYear; year <= endYear; year += 1) history.push({ year: year, value: values.has(year) ? values.get(year) : null }); return history; }
function latestObservation(history) { for (let index = history.length - 1; index >= 0; index -= 1) if (Number.isFinite(history[index].value)) return history[index]; return null; }
export function getEconomicDataset() {
  if (economicDatasetRequest) return economicDatasetRequest;
  economicDatasetRequest = (async function () {
  const cached = readCache("gdp-dataset-v5", CACHE_TTL.gdp); if (cached && Array.isArray(cached.countries) && cached.countries.length) return cached;
  const [countriesPayload, localizedCountriesPayload, gdpRows, pppRows] = await Promise.all([getJson(WB_BASE + "/country?format=json&per_page=400"), getJson(WB_BASE + "/zh/country?format=json&per_page=400").catch(function () { return null; }), getIndicator("NY.GDP.PCAP.CD", 1960), getIndicator("NY.GDP.PCAP.PP.CD", 1960)]);
  const countryRows = worldBankRows(countriesPayload, "country metadata"), localizedRows = localizedCountriesPayload ? worldBankRows(localizedCountriesPayload, "localized country metadata") : [], localizedNames = new Map(localizedRows.map(function (row) { return [row.id, row.name]; }));
  if (!countryRows.length || (!gdpRows.length && !pppRows.length)) throw new Error("World Bank returned no country economic observations.");
  const names = new Map(countryRows.filter(function (row) { return row.id && row.region && row.region.id !== "NA"; }).map(function (row) { return [row.id, { name: row.name, nameZh: localizedNames.get(row.id) || "", iso2: row.iso2Code || "", region: row.region.value || "" }]; }));
  const byCode = new Map(), ensure = function (code) { if (!byCode.has(code)) { const meta = names.get(code) || {}; byCode.set(code, { countryCode: code, countryName: meta.name || code, countryNameZh: meta.nameZh || "", countryIso2: meta.iso2 || "", region: meta.region || "", gdpHistory: [], pppHistory: [] }); } return byCode.get(code); };
  names.forEach(function (_, code) { ensure(code); });
  gdpRows.forEach(function (row) { const value = finiteEconomicValue(row.value), year = Number(row.date); if (!row.countryiso3code || !names.has(row.countryiso3code) || value == null || !Number.isInteger(year)) return; ensure(row.countryiso3code).gdpHistory.push({ year: year, value: value }); });
  pppRows.forEach(function (row) { const value = finiteEconomicValue(row.value), year = Number(row.date); if (!row.countryiso3code || !names.has(row.countryiso3code) || value == null || !Number.isInteger(year)) return; ensure(row.countryiso3code).pppHistory.push({ year: year, value: value }); });
  byCode.forEach(function (country) { country.gdpHistory = completeAnnualHistory(country.gdpHistory); country.pppHistory = completeAnnualHistory(country.pppHistory); const gdpLatest = latestObservation(country.gdpHistory), pppLatest = latestObservation(country.pppHistory); country.latest = { gdp: gdpLatest ? gdpLatest.value : null, gdpYear: gdpLatest ? gdpLatest.year : null, ppp: pppLatest ? pppLatest.value : null, pppYear: pppLatest ? pppLatest.year : null }; });
  return writeCache("gdp-dataset-v5", { countries: Array.from(byCode.values()), source: "World Bank — World Development Indicators", fetchedAt: new Date().toISOString() });
  })();
  economicDatasetRequest.then(function () { economicDatasetRequest = null; }, function () { economicDatasetRequest = null; });
  return economicDatasetRequest;
}
export function filterEconomicCountries(dataset, query) { const normalized = (query || "").trim().toLowerCase(); return dataset.countries.filter(function (country) { return !normalized || country.countryName.toLowerCase().includes(normalized) || (country.countryNameZh || "").toLowerCase().includes(normalized) || country.countryCode.toLowerCase().includes(normalized); }); }

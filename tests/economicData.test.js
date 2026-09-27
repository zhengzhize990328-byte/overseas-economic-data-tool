import assert from "node:assert/strict";
import test from "node:test";

function memoryStorage() { const values = new Map(); return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), dump: key => values.get(key) }; }
function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
let moduleVersion = 0;
async function loadService(fetchImpl, storage = memoryStorage()) { globalThis.fetch = fetchImpl; globalThis.localStorage = storage; moduleVersion += 1; const url = new URL("../src/services/economicData.js", import.meta.url); return { service: await import(url.href + "?test=" + moduleVersion), storage }; }

test("GDP keeps genuine observations, turns invalid values into gaps, and caches null gaps", { concurrency: false }, async () => {
  const { service, storage } = await loadService(async url => {
    const value = String(url);
    if (value.includes("/zh/country")) return response([{}, [{ id: "AAA", name: "甲国" }]]);
    if (value.includes("/country?")) return response([{}, [{ id: "AAA", iso2Code: "AA", name: "Alpha", region: { id: "LCN", value: "Region" } }]]);
    if (value.includes("NY.GDP.PCAP.CD")) return response([{}, [{ countryiso3code: "AAA", date: "2021", value: 100 }, { countryiso3code: "AAA", date: "2022", value: "" }, { countryiso3code: "AAA", date: "2023", value: true }, { countryiso3code: "AAA", date: "2024", value: {} }]]);
    if (value.includes("NY.GDP.PCAP.PP.CD")) return response([{}, [{ countryiso3code: "AAA", date: "2021", value: 200 }]]);
    throw new Error("Unexpected URL " + value);
  });
  const dataset = await service.getEconomicDataset(), country = dataset.countries[0];
  assert.equal(country.latest.gdp, 100);
  assert.equal(country.gdpHistory.find(point => point.year === 2022).value, null);
  assert.equal(country.gdpHistory.find(point => point.year === 2023).value, null);
  assert.equal(country.gdpHistory.find(point => point.year === 2024).value, null);
  assert.equal(JSON.parse(storage.dump("market-atlas:gdp-dataset-v5")).data.countries[0].gdpHistory.find(point => point.year === 2023).value, null);
});

test("a malformed World Bank payload rejects and a later retry can succeed", { concurrency: false }, async () => {
  let attempt = 0;
  const { service } = await loadService(async url => {
    attempt += 1;
    if (attempt <= 4) return response([{ message: [{ value: "temporary payload failure" }] }]);
    const value = String(url);
    if (value.includes("/zh/country")) return response([{}, []]);
    if (value.includes("/country?")) return response([{}, [{ id: "AAA", iso2Code: "AA", name: "Alpha", region: { id: "LCN", value: "Region" } }]]);
    return response([{}, [{ countryiso3code: "AAA", date: "2024", value: 1 }]]);
  });
  await assert.rejects(() => service.getEconomicDataset(), /World Bank/);
  const result = await service.getEconomicDataset();
  assert.equal(result.countries[0].latest.gdp, 1);
});

test("currency catalogue de-duplicates concurrent callers", { concurrency: false }, async () => {
  let calls = 0;
  const { service } = await loadService(async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return response([{ iso_code: "ETB", iso_numeric: "230", name: "Ethiopian Birr", symbol: "Br" }, { iso_code: "CMD", iso_numeric: null, name: "COMESA Dollar", symbol: null }, { iso_code: "CNH", iso_numeric: "", name: "Chinese Renminbi Yuan Offshore", symbol: "¥" }]); });
  const [first, second] = await Promise.all([service.getCurrencies(), service.getCurrencies()]);
  assert.equal(calls, 1);
  assert.equal(first.find(item => item.code === "ETB").code, "ETB");
  assert.equal(first.find(item => item.code === "CMD").nameZh, "东南非共同市场元");
  assert.equal(first.find(item => item.code === "CNH").nameZh, "离岸人民币");
  assert.equal(service.getCurrency("XAU").nameZh, "黄金（盎司）");
  assert.equal(service.getCurrency("ZWG").nameZh, "津巴布韦金");
  assert.equal(second.length, 3);
});

test("FX history filters API boundary rows, retries malformed payloads, and labels MAX as monthly", { concurrency: false }, async () => {
  let malformed = true; const calls = [];
  const { service } = await loadService(async url => {
    const value = String(url); calls.push(value);
    if (malformed) return response({ invalid: true });
    if (value.includes("group=month")) return response([{ date: "1998-07-01", rate: "0.16848" }, { date: "2026-09-01", rate: "4.8708" }]);
    const query = new URL(value).searchParams, start = query.get("from"), end = query.get("to");
    return response([{ date: "0001-01-01", rate: 2 }, { date: start, rate: 3 }, { date: end, rate: true }, { date: "9999-12-31", rate: 4 }]);
  });
  await assert.rejects(() => service.getExchangeHistory("CNY", "AOA", "1Y"), /invalid historical-rate payload/);
  malformed = false;
  const yearly = await service.getExchangeHistory("CNY", "AOA", "1Y");
  assert.deepEqual(yearly.points, [{ date: yearly.availability.requestedStart, value: 3 }]);
  const max = await service.getExchangeHistory("THB", "ETB", "MAX");
  assert.equal(max.frequency, "monthly");
  assert.ok(calls.some(value => value.includes("from=1948-01-01") && value.includes("group=month")));
});

test("long-range FX fallback accepts a valid World Bank rows payload", { concurrency: false }, async () => {
  const { service } = await loadService(async url => {
    const value = String(url);
    if (value.includes("api.frankfurter.dev")) return response({}, 503);
    if (value.includes("PA.NUS.FCRF")) return response([{}, [{ countryiso3code: "CHN", date: "2024", value: 7 }, { countryiso3code: "ETH", date: "2024", value: 14 }]]);
    throw new Error("Unexpected URL " + value);
  });
  const history = await service.getExchangeHistory("CNY", "ETB", "5Y");
  assert.equal(history.frequency, "annual");
  assert.deepEqual(history.points, [{ date: "2024", value: 2 }]);
});

test("same-currency latest rate is an identity without a network request", { concurrency: false }, async () => {
  let calls = 0;
  const { service } = await loadService(async () => { calls += 1; return response({ rate: 2 }); });
  const rate = await service.getLatestRates("CNY", "CNY");
  assert.equal(rate.rates.CNY, 1);
  assert.equal(rate.source, "identity");
  assert.equal(calls, 0);
});

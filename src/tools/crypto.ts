import { tool } from 'ai'
import pc from 'picocolors'
import { z } from 'zod'

const CMC_BASE_URL = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency'

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
})

const compactUsdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2
})

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2
})

interface CoinMarketCapStatus {
  error_code: number
  error_message?: string | null
}

interface CoinMarketCapQuote {
  price: number
  market_cap: number
  volume_24h: number
  percent_change_24h: number
  circulating_supply: number
}

interface CoinMarketCapItem {
  id: number
  name: string
  symbol: string
  cmc_rank: number
  quote: {
    USD: CoinMarketCapQuote
  }
}

interface CoinMarketCapListingsResponse {
  status: CoinMarketCapStatus
  data: CoinMarketCapItem[]
}

interface CoinMarketCapQuotesResponse {
  status: CoinMarketCapStatus
  data: Record<string, CoinMarketCapItem>
}

interface CryptoWidths {
  rank: number
  asset: number
  price: number
  change: number
  marketCap: number
  volume: number
}

export interface CryptoAsset {
  rank: number
  symbol: string
  name: string
  price: number
  marketCap: number
  volume24h: number
  percentChange24h: number
  circulatingSupply: number
}

export interface CryptoSnapshot {
  mode: 'top' | 'quote'
  requestedTicker?: string
  items: CryptoAsset[]
}

function normalizeTicker(value: string): string {
  return value.trim().replace(/^\$/u, '').toUpperCase()
}

function readApiKey(): string {
  const apiKey = process.env.CMC_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('CMC_API_KEY is not set')
  }
  return apiKey
}

async function fetchCmcJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'cale/0.1.0',
      'X-CMC_PRO_API_KEY': readApiKey()
    }
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300)
    throw new Error(`CoinMarketCap request failed: HTTP ${response.status}${body ? `: ${body}` : ''}`)
  }

  const payload = (await response.json()) as unknown
  if (!payload || typeof payload !== 'object') {
    throw new Error('CoinMarketCap returned an invalid response')
  }

  const status = (payload as { status?: CoinMarketCapStatus }).status
  if (status?.error_code && status.error_code !== 0) {
    throw new Error(status.error_message || 'CoinMarketCap returned an error')
  }

  return payload as T
}

function toAsset(item: CoinMarketCapItem): CryptoAsset {
  const quote = item.quote.USD
  return {
    rank: item.cmc_rank,
    symbol: item.symbol,
    name: item.name,
    price: quote.price,
    marketCap: quote.market_cap,
    volume24h: quote.volume_24h,
    percentChange24h: quote.percent_change_24h,
    circulatingSupply: quote.circulating_supply
  }
}

function formatChange(value: number): string {
  const formatted = `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  return value > 0 ? pc.green(formatted) : pc.dim(formatted)
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

function padRight(value: string, width: number): string {
  const visible = stripAnsi(value).length
  if (visible >= width) return value
  return `${value}${' '.repeat(width - visible)}`
}

function padLeft(value: string, width: number): string {
  const visible = stripAnsi(value).length
  if (visible >= width) return value
  return `${' '.repeat(width - visible)}${value}`
}

function buildCryptoWidths(items: CryptoAsset[]): CryptoWidths {
  return items.reduce(
    (widths, asset) => ({
      rank: Math.max(widths.rank, String(asset.rank).length),
      asset: Math.max(widths.asset, stripAnsi(`${pc.cyan(asset.symbol)} ${pc.bold(asset.name)}`).length),
      price: Math.max(widths.price, stripAnsi(pc.yellow(usdFormatter.format(asset.price))).length),
      change: Math.max(widths.change, stripAnsi(formatChange(asset.percentChange24h)).length),
      marketCap: Math.max(widths.marketCap, stripAnsi(pc.dim(compactUsdFormatter.format(asset.marketCap))).length),
      volume: Math.max(widths.volume, stripAnsi(pc.dim(compactUsdFormatter.format(asset.volume24h))).length)
    }),
    {
      rank: 1,
      asset: 5,
      price: 5,
      change: 3,
      marketCap: 4,
      volume: 3
    }
  )
}

function formatCryptoRow(asset: CryptoAsset, widths: CryptoWidths): string {
  return [
    padLeft(pc.dim(String(asset.rank)), widths.rank),
    padRight(`${pc.cyan(asset.symbol)} ${pc.bold(asset.name)}`, widths.asset),
    padLeft(pc.yellow(usdFormatter.format(asset.price)), widths.price),
    padLeft(formatChange(asset.percentChange24h), widths.change),
    padLeft(pc.dim(compactUsdFormatter.format(asset.marketCap)), widths.marketCap),
    padLeft(pc.dim(compactUsdFormatter.format(asset.volume24h)), widths.volume)
  ].join('  ')
}

export function renderCryptoSnapshot(snapshot: CryptoSnapshot): string {
  const lines: string[] = []

  if (snapshot.mode === 'top') {
    lines.push(pc.bold('T10'))
    const widths = buildCryptoWidths(snapshot.items)
    lines.push(
      [
        padLeft(pc.dim('#'), widths.rank),
        padRight(pc.dim('asset'), widths.asset),
        padLeft(pc.dim('price'), widths.price),
        padLeft(pc.dim('24h'), widths.change),
        padLeft(pc.dim('mcap'), widths.marketCap),
        padLeft(pc.dim('vol'), widths.volume)
      ].join('  ')
    )
    lines.push(' ')
    for (const asset of snapshot.items) {
      lines.push(formatCryptoRow(asset, widths))
    }
    return `${lines.join('\n')}\n`
  }

  const asset = snapshot.items[0]
  if (!asset) return `${pc.red('No crypto data found.')}\n`

  lines.push(pc.bold(`${asset.symbol} quote`))
  const widths = buildCryptoWidths([asset])
  lines.push(formatCryptoRow(asset, widths))
  lines.push(pc.dim(`rank #${asset.rank}  supply ${compactNumberFormatter.format(asset.circulatingSupply)}`))
  return `${lines.join('\n')}\n`
}

export async function fetchCryptoSnapshot(ticker?: string): Promise<CryptoSnapshot> {
  if (!ticker) {
    const url = new URL(`${CMC_BASE_URL}/listings/latest`)
    url.searchParams.set('convert', 'USD')
    url.searchParams.set('limit', '10')
    url.searchParams.set('sort', 'market_cap')

    const response = await fetchCmcJson<CoinMarketCapListingsResponse>(url.toString())
    if (!Array.isArray(response.data)) {
      throw new Error('CoinMarketCap listings response was malformed')
    }

    return {
      mode: 'top',
      items: response.data.slice(0, 10).map(toAsset)
    }
  }

  const symbol = normalizeTicker(ticker)
  const url = new URL(`${CMC_BASE_URL}/quotes/latest`)
  url.searchParams.set('convert', 'USD')
  url.searchParams.set('symbol', symbol)

  const response = await fetchCmcJson<CoinMarketCapQuotesResponse>(url.toString())
  const asset = response.data[symbol]
  if (!asset) {
    throw new Error(`No CoinMarketCap quote found for ${symbol}`)
  }

  return {
    mode: 'quote',
    requestedTicker: symbol,
    items: [toAsset(asset)]
  }
}

export const cryptoTool = tool({
  description:
    'Fetch crypto market cap data from CoinMarketCap. Use when a user asks for top crypto by market cap or a specific ticker quote.',
  inputSchema: z.object({
    ticker: z.string().trim().optional().describe('Ticker symbol like BTC, ETH, or SOL')
  }),
  execute: async ({ ticker }) => fetchCryptoSnapshot(ticker)
})

import { fetch } from 'undici'

const fetchHeadlines = async (url: string) => {
  const response = await fetch(url)
  const html = await response.text()
  // Parse the HTML to extract headlines (this is a simplified example)
  // In a real-world scenario, you'd use a proper HTML parser like cheerio or jsdom
  const headlines = html.match(/<h1[^>]*>(.*?)<\/h1>/g)?.map((match) => match.replace(/<[^>]*>/g, '')) || []
  return headlines
}

const headlinesTool = {
  name: 'fetch_headlines',
  description: 'Fetch headlines from a given URL',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch headlines from'
      }
    },
    required: ['url']
  },
  func: fetchHeadlines
}

export default headlinesTool

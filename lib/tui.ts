import { Box, createCliRenderer, Text, TextRenderable } from '@jitl/opentui-core'

const renderer = await createCliRenderer({
  exitOnCtrlC: true
})

const obj = new TextRenderable(renderer, { id: 'my-obj', content: 'Hello, world!' })
const text = Text({ content: 'Buns and muffins!', fg: '#BBBBBB' })
const box = Box(
  {
    borderStyle: 'rounded',
    borderColor: '#34AADC',
    paddingLeft: 1,
    flexDirection: 'column',
    gap: 0
  },
  text
)

renderer.root.add(obj, 0)
renderer.root.add(box, 1)

import { describe, it, expect } from 'vitest'
import {
  blocksToMarkdown,
  blocksToPlainText,
  decodeEntities,
  descriptionBlocks,
  fitBlocks,
  replaceDashes,
} from '@/lib/social-kit/jd-text'

const EN = '\u{2013}'
const EM = '\u{2014}'

describe('descriptionBlocks: employer editor HTML', () => {
  it('reads headings, bold-only paragraphs and lists as structure', () => {
    const html =
      '<h2>Family Nurse Practitioner, Telehealth</h2><p><strong>About Us</strong></p><p>We serve adults across the state.</p>' +
      '<p><strong>Requirements</strong></p><ul><li>Colorado APRN license</li><li>DEA registration</li></ul><p></p>'
    expect(descriptionBlocks(html)).toEqual([
      { kind: 'header', text: 'Family Nurse Practitioner, Telehealth' },
      { kind: 'header', text: 'About Us' },
      { kind: 'para', text: 'We serve adults across the state.' },
      { kind: 'header', text: 'Requirements' },
      { kind: 'bullets', items: ['Colorado APRN license', 'DEA registration'] },
    ])
  })

  it('turns "•" paragraphs into one list and short title lines into headings', () => {
    const html =
      '<p> About the Role</p><p>One afternoon a week at our clinic.</p><p></p>' +
      '<p>Requirements</p><p>• Maryland RN license</p><p>• Active DEA registration</p>'
    expect(descriptionBlocks(html)).toEqual([
      { kind: 'header', text: 'About the Role' },
      { kind: 'para', text: 'One afternoon a week at our clinic.' },
      { kind: 'header', text: 'Requirements' },
      { kind: 'bullets', items: ['Maryland RN license', 'Active DEA registration'] },
    ])
  })

  it('decodes entities and drops inline tags but keeps their words', () => {
    const blocks = descriptionBlocks('<p>Tom &amp; Jerry&#39;s clinic, <em>Schedules II&ndash;V</em>, <a href="https://x.test">our site</a>.</p>')
    expect(blocks).toEqual([{ kind: 'para', text: `Tom & Jerry's clinic, Schedules II${EN}V, our site.` }])
  })

  it('keeps text that sits outside any block tag', () => {
    expect(descriptionBlocks('Intro line<br>second line<ul><li>Item</li></ul>')).toEqual([
      { kind: 'para', text: 'Intro line\nsecond line' },
      { kind: 'bullets', items: ['Item'] },
    ])
  })

  it('drops a heading left with nothing under it', () => {
    expect(descriptionBlocks('<p>Body text here.</p><h3>Benefits</h3>')).toEqual([{ kind: 'para', text: 'Body text here.' }])
  })

  it('keeps a short closing line instead of reading it as an empty heading', () => {
    expect(descriptionBlocks('<p>We reply within two days.</p><p>Equal Opportunity Employer</p>')).toEqual([
      { kind: 'para', text: 'We reply within two days.' },
      { kind: 'para', text: 'Equal Opportunity Employer' },
    ])
  })

  it('treats a short line followed by a real heading as text', () => {
    expect(descriptionBlocks('<p>Apply today</p><h3>Benefits</h3><p>Full medical.</p>')).toEqual([
      { kind: 'para', text: 'Apply today' },
      { kind: 'header', text: 'Benefits' },
      { kind: 'para', text: 'Full medical.' },
    ])
  })

  it('does not read a paragraph with two separate bold runs as a heading', () => {
    const html = '<p><strong>Join us</strong> to help <strong>patients across Colorado every single day</strong></p><p>More.</p>'
    expect(descriptionBlocks(html)[0]).toEqual({ kind: 'para', text: 'Join us to help patients across Colorado every single day' })
  })

  it('keeps words apart across nested lists, paragraphs inside items and loose divs', () => {
    expect(descriptionBlocks('<ul><li>Adults<ul><li>Telehealth</li></ul></li></ul>')).toEqual([
      { kind: 'bullets', items: ['Adults', 'Telehealth'] },
    ])
    expect(descriptionBlocks('<ul><li><p>First</p><p>Second</p></li></ul>')).toEqual([
      { kind: 'bullets', items: ['First', 'Second'] },
    ])
    expect(descriptionBlocks('<div>Alpha</div><div>Beta</div>')).toEqual([{ kind: 'para', text: 'Alpha\nBeta' }])
  })

  it('does not double a bullet typed inside a list item', () => {
    expect(descriptionBlocks('<ul><li>• DEA registration</li></ul>')).toEqual([{ kind: 'bullets', items: ['DEA registration'] }])
  })
})

describe('descriptionBlocks: plain-text descriptions', () => {
  it('uses the job page parser for aggregator text', () => {
    const blocks = descriptionBlocks('RESPONSIBILITIES\n• Evaluate patients\n• Prescribe\n\nWe offer great pay.')
    expect(blocks).toEqual([
      { kind: 'header', text: 'RESPONSIBILITIES' },
      { kind: 'bullets', items: ['Evaluate patients', 'Prescribe'] },
      { kind: 'para', text: 'We offer great pay.' },
    ])
  })

  it('returns nothing for an empty description', () => {
    expect(descriptionBlocks('')).toEqual([])
    expect(descriptionBlocks('<p></p>')).toEqual([])
  })
})

describe('replaceDashes', () => {
  it.each([
    [`$80${EN}$100/hr`, '$80 to $100/hr'],
    [`Schedules II${EN}V`, 'Schedules II to V'],
    [`2 ${EM} 3 weeks`, '2 to 3 weeks'],
    [`full${EN}time`, 'full-time'],
    [`COVID${EN}19`, 'COVID-19'],
    [`(FNP) ${EN} Telehealth | Denver`, '(FNP), Telehealth | Denver'],
    [`We are${EM}truly${EM}growing.`, 'We are, truly, growing.'],
    [`Ends with a dash ${EM}`, 'Ends with a dash'],
    ['Part-Time Nurse Practitioner (FNP) - One Afternoon a Week', 'Part-Time Nurse Practitioner (FNP), One Afternoon a Week'],
    ['$70 - $90 per hour', '$70 to $90 per hour'],
    [`$80K${EN}$100K`, '$80K to $100K'],
    ['$80k - $100k', '$80k to $100k'],
    [`9:00 AM ${EN} 5:00 PM`, '9:00 AM to 5:00 PM'],
    [`Mon ${EM} Fri`, 'Mon to Fri'],
    [`Monday${EN}Friday`, 'Monday to Friday'],
    [`Call 555${EN}1234`, 'Call 555-1234'],
  ])('%j becomes %j', (input, expected) => {
    expect(replaceDashes(input)).toBe(expected)
  })

  it('never leaves an en or em dash behind', () => {
    const messy = `A${EN}B ${EM} C ${EN}${EM} D\n${EM} line start\n12${EN}14`
    expect(replaceDashes(messy)).not.toMatch(/[\u{2013}\u{2014}]/u)
  })
})

describe('rendering', () => {
  const blocks = descriptionBlocks(
    '<h2>Title Line</h2><p><strong>About</strong></p><p>First para.</p><p>Second para.</p><ul><li>One *star*</li><li>two_under</li></ul>',
  )

  it('plain text: a heading sits on its content, a heading under a heading gets a blank line', () => {
    expect(blocksToPlainText(blocks)).toBe(
      'Title Line\n\nAbout\nFirst para.\n\nSecond para.\n\n• One *star*\n• two_under',
    )
  })

  it('markdown: bold headings, escaped emphasis characters, a blank line between blocks', () => {
    expect(blocksToMarkdown(blocks)).toBe(
      '**Title Line**\n\n**About**\n\nFirst para.\n\nSecond para.\n\n* One \\*star\\*\n* two\\_under',
    )
  })

  it('decodeEntities decodes once, not twice', () => {
    expect(decodeEntities('&amp;lt;b&amp;gt; &#x27;x&#39;')).toBe("&lt;b&gt; 'x'")
  })
})

describe('fitBlocks', () => {
  const blocks = descriptionBlocks(
    '<p>Opening paragraph that is fairly long.</p><p><strong>Requirements</strong></p>' +
      '<ul><li>First requirement</li><li>Second requirement</li><li>Third requirement</li></ul><p>Closing.</p>',
  )

  it('keeps everything when it fits', () => {
    const fitted = fitBlocks(blocks, 10_000, blocksToPlainText)
    expect(fitted).toEqual({ blocks, trimmed: false })
  })

  it('stays within the budget and cuts a list between items', () => {
    const budget = blocksToPlainText(blocks.slice(0, 2)).length + '\n• First requirement'.length
    const fitted = fitBlocks(blocks, budget, blocksToPlainText)
    expect(fitted.trimmed).toBe(true)
    expect(blocksToPlainText(fitted.blocks).length).toBeLessThanOrEqual(budget)
    expect(fitted.blocks[fitted.blocks.length - 1]).toEqual({ kind: 'bullets', items: ['First requirement'] })
  })

  it('does not end on a heading with nothing under it', () => {
    const budget = blocksToPlainText(blocks.slice(0, 2)).length + 3
    const fitted = fitBlocks(blocks, budget, blocksToPlainText)
    expect(fitted.blocks.map((b) => b.kind)).toEqual(['para'])
  })
})

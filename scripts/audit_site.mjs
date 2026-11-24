#!/usr/bin/env node
// 网站自动验收（只读，不提交表单）。
// 用法：node audit_site.mjs <url> [url...]
// 每个 URL 在 390×844 和 1440×900 下检查：
//   横向溢出、可见原生控件、坏图、顶部固定层数、页面报错。
// 退出码：0 = 全部通过；1 = 有问题；2 = 用法或环境错误。
// Playwright：先找当前目录可解析的 playwright，再退到 PLAYWRIGHT_PATH，再退到本机已装的一份。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const FALLBACK = null // 项目里没装 playwright 时设 PLAYWRIGHT_PATH 指向 playwright/index.mjs

async function loadPlaywright() {
  try { return await import(createRequire(process.cwd() + '/').resolve('playwright')) } catch {}
  for (const p of [process.env.PLAYWRIGHT_PATH, FALLBACK].filter(Boolean)) {
    try { return await import(pathToFileURL(p).href) } catch {}
  }
  console.error('找不到 playwright：在项目里装一份，或设置 PLAYWRIGHT_PATH 指向 playwright/index.mjs')
  process.exit(2)
}

const urls = process.argv.slice(2)
if (!urls.length) { console.error('用法：node audit_site.mjs <url> [url...]'); process.exit(2) }

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }]

const { chromium } = await loadPlaywright()
// 本机浏览器版本和 playwright 对不上时，设 CHROMIUM_PATH 指向已装的 chromium / headless shell
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
let problems = 0
const flag = (msg) => { problems += 1; console.log('  ✗ ' + msg) }
const pass = (msg) => console.log('  ✓ ' + msg)

for (const url of urls) {
  console.log(`\n${url}`)
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'en-US' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
    const authProbes = []
    // 资源加载失败用 response 事件记 URL；console 里的 "Failed to load resource" 是重复信息
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('console: ' + m.text()) })
    page.on('response', (res) => {
      const s = res.status(); if (s < 400) return
      const path = new URL(res.url()).pathname
      // 未登录时探测会话的 401/403 是正常的，只列出不判错
      if (s === 401 || s === 403) authProbes.push(`${s} ${path}`)
      else errors.push(`HTTP ${s} ${res.url()}`)
    })
    console.log(` [${vp.width}×${vp.height}]`)
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 })
      // 滚到底触发懒加载，再回顶部
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)) }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(800)

      const r = await page.evaluate(() => {
        const visible = (el) => {
          const s = getComputedStyle(el); const b = el.getBoundingClientRect()
          return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01 && b.width > 2 && b.height > 2
        }
        const label = (el) => el.tagName.toLowerCase() + (el.type ? `[type=${el.type}]` : '') + (el.name ? `[name=${el.name}]` : '') + (el.id ? `#${el.id}` : '')
        const overflow = document.documentElement.scrollWidth - window.innerWidth
        const wide = overflow > 1 ? [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && visible(el))
          .slice(0, 5).map((el) => label(el) + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) : []
        const native = [...document.querySelectorAll('select, input[type=date], input[type=time], input[type=datetime-local], input[type=month], input[type=week], input[type=checkbox], input[type=radio], input[type=color], input[type=range]')]
          .filter(visible).map(label)
        const broken = [...document.images].filter((img) => img.complete && img.naturalWidth === 0 && visible(img))
          .map((img) => img.currentSrc || img.src)
        const topLayers = [...document.querySelectorAll('body *')].filter((el) => {
          const s = getComputedStyle(el); if (s.position !== 'fixed' && s.position !== 'sticky') return false
          const b = el.getBoundingClientRect()
          return visible(el) && b.top <= 2 && b.width >= window.innerWidth * 0.6 && b.height < window.innerHeight * 0.5
        })
        // 只数最外层的（嵌套在另一个顶部固定层里的不算）
        const outer = topLayers.filter((el) => !topLayers.some((o) => o !== el && o.contains(el)))
        return { overflow, wide, native, broken, topLayers: outer.map(label) }
      })

      r.overflow > 1 ? flag(`横向溢出 ${r.overflow}px：${r.wide.join(', ')}`) : pass('无横向溢出')
      r.native.length ? flag(`可见原生控件 ${r.native.length}：${r.native.slice(0, 6).join(', ')}`) : pass('无可见原生控件')
      r.broken.length ? flag(`坏图 ${r.broken.length}：${r.broken.slice(0, 4).join(', ')}`) : pass('图片都加载了')
      r.topLayers.length > 1 ? flag(`顶部固定层 ${r.topLayers.length} 层（上限 1）：${r.topLayers.join(', ')}`) : pass(`顶部固定层 ${r.topLayers.length} 层`)
      if (authProbes.length) console.log(`  · 未登录探测：${[...new Set(authProbes)].join(', ')}`)
      errors.length ? flag(`页面报错 ${errors.length}：${errors.slice(0, 3).join(' | ')}`) : pass('无页面报错')
    } catch (e) {
      flag('打开失败：' + e.message.split('\n')[0])
    }
    await ctx.close()
  }
}

await browser.close()
console.log(problems ? `\n${problems} 项需处理` : '\n全部通过')
process.exit(problems ? 1 : 0)

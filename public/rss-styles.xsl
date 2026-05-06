<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
<xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
<xsl:template match="/">
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title><xsl:value-of select="/rss/channel/title"/> — RSS</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="crossorigin"/>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&amp;family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap" rel="stylesheet"/>
<style>
  :root {
    --parchment: #FAFAF7; --parchment-2: #F5F4EE;
    --ink: #1A1A1A; --ink-2: #4A4A47; --ink-3: #76736C;
    --navy: #0A2540; --red: #9B1C1C;
    --hairline: #D4D2CD;
    --serif: 'Source Serif 4', 'Lora', Georgia, serif;
    --sans: 'Inter', system-ui, sans-serif;
    --mono: 'JetBrains Mono', ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--parchment); color: var(--ink);
    font-family: var(--sans); font-size: 17px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--ink); text-decoration-color: var(--hairline); text-underline-offset: 3px; }
  a:hover { color: var(--navy); text-decoration-color: var(--navy); }
  .wrap { max-width: 720px; margin: 0 auto; padding: 56px 24px 80px; }
  .brand-mark {
    font-family: var(--serif); font-weight: 700; letter-spacing: 0.01em;
    display: inline-flex; align-items: baseline; line-height: 1; font-size: 44px;
  }
  .brand-mark .roman { color: var(--red); font-style: italic; margin-left: 0.12em; position: relative; top: 0.06em; font-size: 70px; }
  .kicker {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--red); margin-bottom: 18px;
  }
  h1 {
    font-family: var(--serif); font-weight: 700; font-size: 48px; line-height: 1.08;
    letter-spacing: -0.012em; margin: 14px 0 18px; text-wrap: balance;
  }
  .deck {
    font-family: var(--serif); font-style: italic; font-size: 21px; line-height: 1.5;
    color: var(--ink-2); margin: 0 0 24px; max-width: 600px;
  }
  .info {
    background: var(--parchment-2); border: 1px solid var(--hairline);
    padding: 18px 22px; margin: 0 0 32px;
    font-family: var(--sans); font-size: 15px; line-height: 1.55; color: var(--ink-2);
  }
  .info code {
    font-family: var(--mono); font-size: 13px; background: rgba(10,37,64,0.06);
    padding: 1px 6px; color: var(--navy);
  }
  .feed-h2 {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--ink-3); margin: 32px 0 14px;
    padding-bottom: 10px; border-bottom: 1px solid var(--hairline);
  }
  article.entry {
    padding: 22px 0; border-bottom: 1px solid var(--hairline);
  }
  article.entry:last-child { border-bottom: 0; }
  .entry h2 {
    font-family: var(--serif); font-weight: 700; font-size: 24px; line-height: 1.2;
    margin: 0 0 8px; letter-spacing: -0.005em; text-wrap: balance;
  }
  .entry h2 a { color: var(--ink); text-decoration: none; }
  .entry h2 a:hover { color: var(--navy); }
  .entry-meta {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-3); margin-bottom: 10px;
  }
  .entry-desc {
    font-family: var(--sans); font-size: 16px; color: var(--ink); margin: 0;
  }
  .footer {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--ink-3); text-align: center;
    margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--hairline);
  }
</style>
</head>
<body>
<div class="wrap">
  <a href="/" style="text-decoration: none;">
    <span class="brand-mark"><span>Article</span><span class="roman">I</span></span>
  </a>
  <div class="kicker" style="margin-top: 18px;">RSS Feed</div>
  <p class="deck"><xsl:value-of select="/rss/channel/description"/></p>

  <div class="info">
    <strong>This is an RSS feed.</strong> To subscribe, copy the URL from your address bar and paste it into your feed reader (Feedly, NetNewsWire, Inoreader, etc.). Or read the latest posts directly at
    <a><xsl:attribute name="href"><xsl:value-of select="/rss/channel/link"/></xsl:attribute>article1.news</a>.
  </div>

  <h2 class="feed-h2">Latest entries</h2>

  <xsl:for-each select="/rss/channel/item">
    <article class="entry">
      <h2>
        <a>
          <xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>
          <xsl:value-of select="title"/>
        </a>
      </h2>
      <div class="entry-meta">
        <xsl:value-of select="pubDate"/>
      </div>
      <p class="entry-desc"><xsl:value-of select="description"/></p>
    </article>
  </xsl:for-each>

  <div class="footer">
    Article I — American politics through the lens of the Constitution and the long memory.
  </div>
</div>
</body>
</html>
</xsl:template>
</xsl:stylesheet>

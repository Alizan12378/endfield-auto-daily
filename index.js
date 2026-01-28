#!/usr/bin/env node

/**
 * Arknights: Endfield Auto Daily Check-in
 * Simple script for automated daily attendance via SKPort API
 */

const creds = process.env.CRED.split('\n').map(s => s.trim()).filter(Boolean)
const discordWebhook = process.env.DISCORD_WEBHOOK
const discordUser = process.env.DISCORD_USER

const ATTENDANCE_URL = 'https://zonai.skport.com/web/v1/game/endfield/attendance'
const messages = []
let hasErrors = false

/**
 * Build headers for SKPort API
 */
function buildHeaders(cred) {
  // cred format: "cred|sk_game_role" or just "cred" if role is embedded
  const [credToken, gameRole] = cred.includes('|') ? cred.split('|') : [cred, null]

  const headers = {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'origin': 'https://game.skport.com',
    'referer': 'https://game.skport.com/',
    'cred': credToken.trim(),
    'platform': '3',
    'sk-language': 'en',
    'timestamp': Math.floor(Date.now() / 1000).toString(),
    'vname': '1.0.0',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  }

  if (gameRole) {
    headers['sk-game-role'] = gameRole.trim()
  }

  return headers
}

/**
 * Check if already signed in today
 */
async function checkAttendance(headers) {
  const res = await fetch(ATTENDANCE_URL, { method: 'GET', headers })
  const json = await res.json()

  if (json.code !== 0) {
    throw new Error(json.message || `API error code: ${json.code}`)
  }

  return {
    hasToday: json.data?.hasToday ?? false,
    totalSignIns: json.data?.records?.length ?? 0
  }
}

/**
 * Claim daily attendance
 */
async function claimAttendance(headers) {
  const res = await fetch(ATTENDANCE_URL, { method: 'POST', headers, body: null })
  const json = await res.json()

  if (json.code !== 0) {
    throw new Error(json.message || `API error code: ${json.code}`)
  }

  // Parse rewards
  const rewards = []
  const awardIds = json.data?.awardIds ?? []
  const resourceMap = json.data?.resourceInfoMap ?? {}

  for (const award of awardIds) {
    const info = resourceMap[award.id]
    if (info) {
      rewards.push(`${info.name} x${info.count}`)
    }
  }

  return { rewards }
}

/**
 * Run check-in for a single account
 */
async function run(cred, accountIndex) {
  log('debug', `\n----- CHECKING IN FOR ACCOUNT ${accountIndex} -----`)

  try {
    const headers = buildHeaders(cred)

    // Step 1: Check status
    const status = await checkAttendance(headers)

    if (status.hasToday) {
      log('info', `Account ${accountIndex}:`, 'Already checked in today')
      return
    }

    // Step 2: Claim if not signed in
    const result = await claimAttendance(headers)

    if (result.rewards.length > 0) {
      log('info', `Account ${accountIndex}:`, `Successfully checked in! Rewards: ${result.rewards.join(', ')}`)
    } else {
      log('info', `Account ${accountIndex}:`, 'Successfully checked in!')
    }

  } catch (error) {
    log('error', `Account ${accountIndex}:`, error.message)
  }
}

/**
 * Custom log function to store messages
 */
function log(type, ...data) {
  console[type](...data)

  switch (type) {
    case 'debug': return
    case 'error': hasErrors = true
  }

  const string = data
    .map(value => typeof value === 'object' ? JSON.stringify(value, null, 2) : value)
    .join(' ')

  messages.push({ type, string })
}

/**
 * Send results to Discord webhook
 */
async function discordWebhookSend() {
  log('debug', '\n----- DISCORD WEBHOOK -----')

  if (!discordWebhook.toLowerCase().trim().startsWith('https://discord.com/api/webhooks/')) {
    log('error', 'DISCORD_WEBHOOK is not a Discord webhook URL')
    return
  }

  let discordMsg = ''
  if (discordUser) {
    discordMsg = `<@${discordUser}>\n`
  }
  discordMsg += '**Endfield Daily Check-in**\n'
  discordMsg += messages.map(msg => `(${msg.type.toUpperCase()}) ${msg.string}`).join('\n')

  const res = await fetch(discordWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: discordMsg })
  })

  if (res.status === 204) {
    log('info', 'Successfully sent message to Discord webhook!')
    return
  }

  log('error', 'Error sending message to Discord webhook')
}

// Main execution
if (!creds || !creds.length) {
  throw new Error('CRED environment variable not set!')
}

for (const index in creds) {
  await run(creds[index], Number(index) + 1)
}

if (discordWebhook && URL.canParse(discordWebhook)) {
  await discordWebhookSend()
}

if (hasErrors) {
  console.log('')
  throw new Error('Error(s) occurred.')
}

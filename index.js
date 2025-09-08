// Bloz Discord Bot (banter edition)
// Single‑file bot using discord.js v14
// Features:
// - Per‑channel modes: "links-only" (delete non‑links), "no-links" (delete links), "off"
// - Optional domain whitelist (only allow links from certain domains)
// - Optional bypass roles (members with any bypass role are ignored by moderation)
// - Playful banter warnings (auto‑delete)
// - Slash commands to configure everything (guild‑scoped)
// - Lightweight JSON persistence (data.json)
//
// ENV required:
//   DISCORD_TOKEN=...
//   DISCORD_CLIENT_ID=...
// Optional:
//   BOT_PERSONA_NAME=Bloz   // used in banter lines
//   WARN_TTL_MS=6000           // how long to keep warning replies
//
// Deploy tip: on Railway set the Start Command to: node index.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";

// ---------- Helpers & persistence ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, "data.json");

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return { guilds: {} };
  }
}
function saveStore() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error("Failed to save data store:", e);
  }
}

const store = loadStore();

function gcfg(guildId) {
  if (!store.guilds[guildId]) store.guilds[guildId] = { channels: {}, whitelist: [], bypassRoles: [] };
  return store.guilds[guildId];
}

// Channel mode helpers
const MODES = ["off", "links-only", "no-links"]; // default off
const URL_REGEX = /\b((?:https?:\/\/)?(?:[\w-]+\.)+[\w-]{2,}(?:\/[\w\-._~:/?#[\]@!$&'()*+,;=%]*)?)\b/i;

function extractDomains(text) {
  if (!text) return [];
  const all = [];
  const urlRegexGlobal = /\bhttps?:\/\/[^\s>]+/gi;
  let m;
  while ((m = urlRegexGlobal.exec(text))) {
    try {
      const u = new URL(m[0]);
      all.push(u.hostname.replace(/^www\./, ""));
    } catch {
      /* ignore */
    }
  }
  return all;
}

function hasUrl(text) {
  return URL_REGEX.test(text || "");
}

// Banter lines (Bloosem the bouncer style)
const persona = process.env.BOT_PERSONA_NAME || "Bloz";
function spicy(line) {
  return `💬 ${persona}: ${line}`;
}
const warnings = {
  nonLink: [
    "_Bloosem laughs: Hun, this ain’t Top Edit Tuesday — bring a link or jog on._",
    "_Bloosem blocks you harder than a bad catalog copycat._",
    "_Bloosem smirks: Models strut, creators post, and you… typed? Cute, but no._",
    "_Bloosem checks the runway list: nope, no text booked for tonight._",
    "_Bloosem drags: even Toci drops links smoother than that mess._",
    "_Bloosem side-eyes: Eli would’ve roasted you already — probably after finishing her coffee._",
    "_Bloosem snatches your message like it was fake credits bait._",
    "_Bloosem whispers: darling, this isn’t a pageant Q&A. Links or leave._",
    "_Bloosem raises a brow: giveaways pay in credits, not sentences._",
    "_Bloosem deletes it faster than a model dodges free gift DMs._",
    "_Bloosem grins: even Toci wouldn’t try posting plain text here._",
    "_Bloosem claps: Eli’s backstage laughing at that weak entry while sipping her coffee._"
  ],

  linkNotAllowed: [
    "_Oi, wrong link for this giveaway — Bloosem just bounced it out._",
    "_Bloosem spotted a dodgy link. Not today, pal._",
    "_This isn’t the right runway — Bloosem’s got you covered._",
    "_Bloosem whispers: even Eli knows better than to drop that flop link — and she hasn’t even finished her coffee yet._",
    "_Bloosem smirks: Toci would’ve roasted you first, I just finished the job._"
  ],

  domainBlocked: (domain) => [
    `_Bloosem side-eyes ${domain}: not on the VIP list, hun. Back to the queue._`,
    `_Bloosem stamps REJECTED on ${domain} — this giveaway doesn’t take knock-offs._`,
    `_Bloosem rolls her eyes: ${domain}? That’s about as useful as an empty wishlist._`,
    `_Bloosem cackles: ${domain} tried the velvet rope — denied harder than a spam wishlist._`,
    `_Bloosem chuckles: ${domain}? Even Toci wouldn’t get caught posting that flop._`,
    `_Bloosem whispers: ${domain}? Cute, but Eli’s already rolling her eyes at you while sipping her coffee._`,
    `_Bloosem raises an eyebrow: ${domain}? Hun, I bounce harder than Toci’s clapbacks._`,
    `_Bloosem laughs: ${domain}? Eli says nope, and I double it._`
  ]
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}


// ---------- Discord client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// ---------- Slash commands ----------
const cmds = [
  new SlashCommandBuilder()
    .setName("mode")
    .setDescription("Set or view the moderation mode for a channel")
    .addStringOption(o => o
      .setName("mode")
      .setDescription("off | links-only | no-links")
      .addChoices(
        { name: "off", value: "off" },
        { name: "links-only", value: "links-only" },
        { name: "no-links", value: "no-links" },
      )
      .setRequired(true))
    .addChannelOption(o => o
      .setName("channel")
      .setDescription("Target channel (defaults to current)")
      .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Manage allowed link domains")
    .addStringOption(o => o
      .setName("action")
      .setDescription("add | remove | list | clear")
      .addChoices(
        { name: "add", value: "add" },
        { name: "remove", value: "remove" },
        { name: "list", value: "list" },
        { name: "clear", value: "clear" },
      )
      .setRequired(true))
    .addStringOption(o => o
      .setName("domain")
      .setDescription("e.g. youtube.com, discord.gg")
      .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  
  new SlashCommandBuilder()
  .setName("cleanup")
  .setDescription("Delete recent messages that don’t match the link-only rules")
  .addIntegerOption(o =>
    o.setName("limit")
     .setDescription("How many recent messages to scan (max 100)")
     .setMinValue(1)
     .setMaxValue(100)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
 
  new SlashCommandBuilder()
    .setName("bypass")
    .setDescription("Manage bypass roles (members with these roles are ignored by moderation)")
    .addStringOption(o => o
      .setName("action")
      .setDescription("add | remove | list | clear")
      .addChoices(
        { name: "add", value: "add" },
        { name: "remove", value: "remove" },
        { name: "list", value: "list" },
        { name: "clear", value: "clear" },
      )
      .setRequired(true))
    .addRoleOption(o => o
      .setName("role")
      .setDescription("Role to add/remove")
      .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Show current settings for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("test")
    .setDescription("Test the detector against some text")
    .addStringOption(o => o.setName("text").setDescription("Paste text").setRequired(true))
];

async function registerGuildCommands(guildId) {
  const body = cmds.map(c => c.toJSON());
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body });
    console.log(`Registered commands for guild ${guildId}`);
  } catch (e) {
    console.error("Command registration failed:", e);
  }
}

client.on("guildCreate", (guild) => {
  registerGuildCommands(guild.id);
});
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  // Register for all cached guilds (useful on restarts)
  for (const [id] of client.guilds.cache) {
    await registerGuildCommands(id);
  }
});

// ---------- Message filter ----------
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    const cfg = gcfg(message.guild.id);

    // Bypass roles
    if (cfg.bypassRoles?.length) {
      const hasBypass = message.member?.roles.cache.some(r => cfg.bypassRoles.includes(r.id));
      if (hasBypass) return; // skip all checks
    }

    const channelMode = cfg.channels[message.channel.id] || "off";
    if (channelMode === "off") return;

    const content = message.content.trim();
    // Regex: must be exactly ONE Instagram link, nothing else
    const instaRegex = /^https?:\/\/(www\.)?instagram\.com\/[^\s]+$/;
    const isInstagramOnly = instaRegex.test(content);


    if (!isInstagramOnly) {
      await safeDelete(message, pick(warnings.nonLink));
      return;
    }


    if (channelMode === "links-only" && !hasLink) {
      await safeDelete(message, pick(warnings.nonLink));
      return;
    }

    if (channelMode === "no-links" && hasLink) {
      await safeDelete(message, pick(warnings.linkNotAllowed));
      return;
    }
  } catch (e) {
    console.error("messageCreate handler error:", e);
  }
});

async function safeDelete(message, warnText) {
  try {
    const ttl = Number(process.env.WARN_TTL_MS || 6000);
    const reply = await message.reply({ content: spicy(warnText) });
    setTimeout(() => reply.delete().catch(() => {}), ttl);
    await message.delete().catch(() => {});
  } catch (e) {
    console.error("Failed to delete or warn:", e);
  }
}

// ---------- Command handlers ----------
client.on("interactionCreate", async (i) => {
  try {
    if (!i.isChatInputCommand()) return;
    const guildId = i.guildId; if (!guildId) return i.reply({ content: "Guild only.", ephemeral: true });
    const cfg = gcfg(guildId);

    switch (i.commandName) {
      case "mode": {
        const mode = i.options.getString("mode", true);
        const channel = i.options.getChannel("channel") || i.channel;
        if (!MODES.includes(mode)) return i.reply({ content: "Invalid mode.", ephemeral: true });
        cfg.channels[channel.id] = mode;
        saveStore();
        return i.reply({
          content: `Mode for <#${channel.id}> set to **${mode}**.`,
          ephemeral: true,
        });
      }

      case "whitelist": {
        const action = i.options.getString("action", true);
        const domain = (i.options.getString("domain") || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
        if (action === "add") {
          if (!domain) return i.reply({ content: "Provide a domain like `youtube.com`.", ephemeral: true });
          if (!cfg.whitelist.includes(domain)) cfg.whitelist.push(domain);
          saveStore();
          return i.reply({ content: `Added **${domain}** to whitelist.`, ephemeral: true });
        }
        if (action === "remove") {
          if (!domain) return i.reply({ content: "Provide a domain to remove.", ephemeral: true });
          cfg.whitelist = cfg.whitelist.filter(d => d !== domain);
          saveStore();
          return i.reply({ content: `Removed **${domain}** from whitelist.`, ephemeral: true });
        }
        if (action === "list") {
          const list = cfg.whitelist.length ? cfg.whitelist.map(d => `• ${d}`).join("\n") : "(empty)";
          return i.reply({ content: `**Allowed domains:**\n${list}` , ephemeral: true });
        }
        if (action === "clear") {
          cfg.whitelist = [];
          saveStore();
          return i.reply({ content: `Whitelist cleared.`, ephemeral: true });
        }
        break;
      }

      case "cleanup": {
        try {
          // acknowledge immediately so Discord doesn't timeout
          await i.deferReply({ ephemeral: true });
      
          const limit = i.options.getInteger("limit") ?? 50;
          const cfg = gcfg(i.guildId);
      
          // fetch up to 100 recent messages
          const fetched = await i.channel.messages.fetch({ limit: Math.min(limit, 100) });
      
          let deleted = 0;
          for (const msg of fetched.values()) {
            if (!msg || msg.author?.bot) continue;
      
            const content = (msg.content || "").trim();
            const urls = content.match(/https?:\/\/[^\s]+/gi) || [];
            const onlyOneLink = urls.length === 1 && content === urls[0];
      
            // rule: message must be exactly one link and no extra text
            let bad = !onlyOneLink;
      
            // whitelist rule (if configured)
            if (!bad && cfg.whitelist?.length) {
              let host = "";
              try {
                host = new URL(urls[0]).hostname.replace(/^www\./, "");
              } catch {}
              const allowed = cfg.whitelist.some(d => host === d || host.endsWith(`.${d}`));
              if (!allowed) bad = true;
            }
      
            if (bad) {
              await msg.delete().catch(() => {}); // ignore items we can't delete
              deleted++;
            }
          }

    await i.editReply(`🧹 Cleaned ${deleted} message(s).`);
  } catch (err) {
    console.error("cleanup error:", err);
    // Show a helpful reason if it's permissions
    await i.editReply("⚠️ Couldn’t complete cleanup. Check that Bloz has **Manage Messages** and **Read Message History** in this channel.");
  }
  break;
}

  
      case "bypass": {
        const action = i.options.getString("action", true);
        const role = i.options.getRole("role");
        if (action === "add") {
          if (!role) return i.reply({ content: "Pick a role to add.", ephemeral: true });
          if (!cfg.bypassRoles.includes(role.id)) cfg.bypassRoles.push(role.id);
          saveStore();
          return i.reply({ content: `Added bypass role: <@&${role.id}>.`, ephemeral: true });
        }
        if (action === "remove") {
          if (!role) return i.reply({ content: "Pick a role to remove.", ephemeral: true });
          cfg.bypassRoles = cfg.bypassRoles.filter(id => id !== role.id);
          saveStore();
          return i.reply({ content: `Removed bypass role: <@&${role.id}>.`, ephemeral: true });
        }
        if (action === "list") {
          const list = cfg.bypassRoles.length ? cfg.bypassRoles.map(id => `• <@&${id}>`).join("\n") : "(none)";
          return i.reply({ content: `**Bypass roles:**\n${list}`, ephemeral: true });
        }
        if (action === "clear") {
          cfg.bypassRoles = [];
          saveStore();
          return i.reply({ content: `Bypass roles cleared.`, ephemeral: true });
        }
        break;
      }

      case "settings": {
        const lines = [];
        const channels = Object.entries(cfg.channels);
        lines.push(`**Modes:**`);
        lines.push(channels.length ? channels.map(([cid, mode]) => `• <#${cid}> → **${mode}**`).join("\n") : "(none)");
        lines.push("");
        lines.push(`**Whitelist:** ${cfg.whitelist.length ? cfg.whitelist.join(", ") : "(empty)"}`);
        lines.push(`**Bypass roles:** ${cfg.bypassRoles.length ? cfg.bypassRoles.map(id => `<@&${id}>`).join(", ") : "(none)"}`);
        return i.reply({ content: lines.join("\n"), ephemeral: true });
      }

      case "test": {
        const text = i.options.getString("text", true);
        const link = hasUrl(text);
        const domains = extractDomains(text);
        return i.reply({ content: `Has URL: **${link ? "yes" : "no"}**\nDomains: ${domains.length ? domains.join(", ") : "(none)"}`, ephemeral: true });
      }
    }
  } catch (e) {
    console.error("interactionCreate error:", e);
    if (i.isRepliable()) {
      i.reply({ content: "Something went sideways. Try again.", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

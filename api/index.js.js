const express = require('express');
const cors = require('cors');

const app = express();
const STEAM_API_KEY = 'C42FF616FEEDAAF0DA435BEFEA17E7A7'; 

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

// 1. ROTA DE CNPJ
app.get('/api/v1/corporate/:cnpj', async (req, res) => {
    const { cnpj } = req.params;
    const sanitizedCnpj = cnpj.replace(/\D/g, '');
    if (sanitizedCnpj.length !== 14) return res.status(400).json({ error: 'Formato de CNPJ inválido.' });
    try {
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${sanitizedCnpj}`);
        if (!response.ok) return res.status(response.status).json({ error: 'Não localizado.' });
        const data = await response.json();
        res.json({
            legalName: data.razao_social,
            tradeName: data.nome_fantasia || 'Não informado',
            status: data.descricao_situacao_cadastral,
            foundedAt: data.data_inicio_atividade,
            address: { street: data.logradouro, city: data.municipio, state: data.uf },
            partners: data.socios ? data.socios.map(s => ({ name: s.nome, role: s.qualificacao_socio })) : []
        });
    } catch (error) { res.status(500).json({ error: 'Erro no servidor.' }); }
});

// 2. ROTA OSINT
app.get('/api/v1/osint/gamer-profile/:username', async (req, res) => {
    let { username } = req.params;
    let cleanUser = username.trim().toLowerCase();
    
    if (cleanUser.includes('steamcommunity.com')) {
        const match = cleanUser.match(/(?:id|profiles)\/([a-z0-9_]+)/i);
        if (match && match[1]) cleanUser = match[1];
    }
    cleanUser = cleanUser.replace('@', '').replace(/\//g, '').trim();

    if (!cleanUser) return res.status(400).json({ error: 'Digite um nickname ou ID válido.' });

    try {
        let steamData = { found: false, gamesList: [] };
        let steamID = null;

        if (/^\d+$/.test(cleanUser) && cleanUser.length >= 16) {
            steamID = cleanUser;
        } else {
            try {
                const resolveRes = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${cleanUser}`);
                const resolveData = await resolveRes.json();
                if (resolveData.response && resolveData.response.success === 1) steamID = resolveData.response.steamid;
            } catch (e) { console.log(e.message); }
        }

        if (steamID) {
            try {
                const userRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamID}`);
                const userData = await userRes.json();

                if (userData.response && userData.response.players && userData.response.players.length > 0) {
                    const player = userData.response.players[0];
                    const isPublic = player.communityvisibilitystate === 3;

                    let gameCount = "Oculto/Privado";
                    let recentPlaytime = "Oculto/Privado";
                    let gamesList = [];

                    if (isPublic) {
                        const gamesRes = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamID}&include_appinfo=1&include_played_free_games=1&format=json`);
                        const gamesData = await gamesRes.json();
                        
                        if (gamesData.response && gamesData.response.games) {
                            gameCount = `${gamesData.response.game_count} jogos detectados`;
                            gamesList = gamesData.response.games.map(g => ({
                                name: g.name,
                                playtime: `${Math.round(g.playtime_forever / 60)} horas jogadas`
                            }));
                            const recentHours = gamesData.response.games.reduce((acc, game) => acc + (game.playtime_2weeks || 0), 0);
                            recentPlaytime = recentHours > 0 ? `${Math.round(recentHours / 60)} horas nas últimas 2 semanas` : "Nenhuma atividade recente";
                        }
                    }

                    steamData = {
                        found: true,
                        steamID: steamID,
                        personaName: player.personaname,
                        realName: player.realname || "Não exposto",
                        avatar: player.avatarfull,
                        country: player.loccountrycode || "Não informado",
                        privacy: isPublic ? "🟢 PERFIL PÚBLICO" : "🔴 PERFIL PRIVADO",
                        createdAt: player.timecreated ? new Date(player.timecreated * 1000).toLocaleDateString('pt-BR') : "Oculta",
                        status: player.personastate === 0 ? "Offline" : "Online / Ativo",
                        gameCount: gameCount,
                        recentPlaytime: recentPlaytime,
                        gamesList: gamesList,
                        bioSummary: player.summary || ""
                    };
                }
            } catch (e) { console.log(e.message); }
        }

        // GITHUB SCAN
        let githubData = { found: false };
        try {
            const ghRes = await fetch(`https://api.github.com/users/${cleanUser}`, { headers: { 'User-Agent': 'Node-OSINT-App' } });
            if (ghRes.ok) {
                const gh = await ghRes.json();
                githubData = {
                    found: true,
                    name: gh.name || "Não informado",
                    bio: gh.bio || "Sem biografia pública",
                    email: gh.email || "Não exposto",
                    company: gh.company || "Nenhuma informada",
                    location: gh.location || "Não informada",
                    publicRepos: gh.public_repos,
                    followers: gh.followers,
                    createdAt: new Date(gh.created_at).toLocaleDateString('pt-BR')
                };
            }
        } catch (e) { console.log(e.message); }

        // FOOTPRINT SCAN
        const networksToScan = [
            { name: "Reddit", url: `https://www.reddit.com/user/${cleanUser}`, antiPhrases: ["nobody on reddit", "banned", "404"] },
            { name: "Pinterest", url: `https://www.pinterest.com/${cleanUser}/`, antiPhrases: ["resource not found", "404"] },
            { name: "Twitch", url: `https://twitch.tv/${cleanUser}`, antiPhrases: ["não encontrado", "404"] },
            { name: "SoundCloud", url: `https://soundcloud.com/${cleanUser}`, antiPhrases: ["can't find that user", "404"] }
        ];

        const scanResults = [];
        for (const net of networksToScan) {
            try {
                const response = await fetch(net.url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (response.status === 200) {
                    const textHTML = await response.text();
                    const isFake = net.antiPhrases.some(phrase => textHTML.toLowerCase().includes(phrase));
                    scanResults.push({ name: net.name, status: isFake ? "NÃO IDENTIFICADO" : "LOCALIZADO", link: net.url, badge: isFake ? "badge-danger" : "badge-success" });
                } else {
                    scanResults.push({ name: net.name, status: "NÃO IDENTIFICADO", link: net.url, badge: "badge-danger" });
                }
            } catch (err) {
                scanResults.push({ name: net.name, status: "ANÁLISE REQUERIDA", link: net.url, badge: "badge-warning" });
            }
        }

        res.json({
            username: cleanUser,
            scanTime: new Date().toLocaleString('pt-BR'),
            steam: steamData,
            github: githubData,
            footprint: scanResults,
            manualLinks: {
                instagram: `https://instagram.com/${cleanUser}`,
                twitterX: `https://x.com/${cleanUser}`,
                youtube: `https://youtube.com/@${cleanUser}`
            }
        });

    } catch (error) {
        res.status(500).json({ error: 'Erro crítico no processamento OSINT.' });
    }
});

// Exporta o app para a Vercel controlar as rotas
module.exports = app;
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Adicionado para fazer requisições mais robustas de OSINT

const app = express();
const STEAM_API_KEY = 'C42FF616FEEDAAF0DA435BEFEA17E7A7'; 

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

// 1. ROTA DE CNPJ (Mantida intacta)
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

// 2. ROTA OSINT MASTER (Atualizada com Histórico de Nicks e TikTok Tracker)
app.get('/api/v1/osint/gamer-profile/:username', async (req, res) => {
    let { username } = req.params;
    let cleanUser = username.trim();

    // --- DETECTOR E RASTREADOR DE LINKS DO TIKTOK ---
    if (cleanUser.includes('tiktok.com')) {
        try {
            // Faz requisição simulando dispositivo móvel para pescar metadados de rastreio de quem gerou o link
            const tkResponse = await axios.get(cleanUser, {
                maxRedirects: 5,
                headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15' }
            });

            const urlFinal = tkResponse.request.res.responseUrl || cleanUser;
            const urlObj = new URL(urlFinal);

            // Captura os códigos de identificação do remetente injetados na URL pelo App do TikTok
            const shareUid = urlObj.searchParams.get('share_uid') || 'Não injetado (Link limpo)';
            const senderDevice = urlObj.searchParams.get('sender_device') || urlObj.searchParams.get('_r') || 'Não detectado';

            return res.json({
                username: "Modulo_TikTok_OSINT",
                scanTime: new Date().toLocaleString('pt-BR'),
                isTikTokLink: true,
                tiktok: {
                    urlOriginal: cleanUser,
                    urlExpandida: urlFinal,
                    donoDoVideo: urlFinal.split('@')[1]?.split('/')[0] || "Desconhecido",
                    videoId: urlFinal.split('/video/')[1]?.split('?')[0] || "Não extraído",
                    vinculoAmigo: {
                        alerta: "Se o seu amigo copiou este link diretamente de dentro do aplicativo dele, os IDs abaixo pertencem à conta dele.",
                        share_uid_remetente: shareUid,
                        device_tracking_code: senderDevice
                    }
                }
            });
        } catch (err) {
            return res.status(500).json({ error: 'Erro ao desmembrar metadados do TikTok.', detalhes: err.message });
        }
    }

    // --- SEGUIMENTO DO FLUXO NORMAL (STEAM, GITHUB, FOOTPRINT) ---
    let cleanUserLower = cleanUser.toLowerCase();
    if (cleanUserLower.includes('steamcommunity.com')) {
        const match = cleanUserLower.match(/(?:id|profiles)\/([a-z0-9_]+)/i);
        if (match && match[1]) cleanUserLower = match[1];
    }
    cleanUserLower = cleanUserLower.replace('@', '').replace(/\//g, '').trim();

    if (!cleanUserLower) return res.status(400).json({ error: 'Digite um nickname ou ID válido.' });

    try {
        let steamData = { found: false, gamesList: [], aliasesHistory: [] };
        let steamID = null;

        if (/^\d+$/.test(cleanUserLower) && cleanUserLower.length >= 16) {
            steamID = cleanUserLower;
        } else {
            try {
                const resolveRes = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${cleanUserLower}`);
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
                    let aliasesHistory = ["Perfil privado ou histórico indisponível no cache público"];

                    // RASPAR HISTÓRICO DE NICKS DA STEAM DA PÁGINA PÚBLICA
                    try {
                        const profilePage = await axios.get(`https://steamcommunity.com/profiles/${steamID}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        });
                        if (profilePage && profilePage.data) {
                            const matches = profilePage.data.match(/PersonaHistoryNameGroup">([\s\S]*?)<\/div>/g);
                            if (matches) {
                                aliasesHistory = matches.map(m => m.replace(/<[^>]*>/g, '').trim());
                            } else {
                                aliasesHistory = ["Nenhum apelido anterior registrado recentemente ou perfil limpo"];
                            }
                        }
                    } catch (err) { console.log("Erro ao buscar nicks antigos: " + err.message); }

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
                        aliasesHistory: aliasesHistory, // Adicionado ao retorno do objeto Steam
                        bioSummary: player.summary || ""
                    };
                }
            } catch (e) { console.log(e.message); }
        }

        // GITHUB SCAN (Mantido intacto)
        let githubData = { found: false };
        try {
            const ghRes = await fetch(`https://api.github.com/users/${cleanUserLower}`, { headers: { 'User-Agent': 'Node-OSINT-App' }

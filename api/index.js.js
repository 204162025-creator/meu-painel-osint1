const STEAM_API_KEY = 'C42FF616FEEDAAF0DA435BEFEA17E7A7'; 

module.exports = async (req, res) => {
    // Cabeçalhos obrigatórios para evitar travamentos de CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req;

    // --- 1. FILTRO DA ROTA DE CNPJ ---
    if (url.includes('/api/v1/corporate/')) {
        const cnpj = url.split('/corporate/')[1]?.split('?')[0];
        if (!cnpj) return res.status(400).json({ error: 'CNPJ não informado.' });
        
        const sanitizedCnpj = cnpj.replace(/\D/g, '');
        if (sanitizedCnpj.length !== 14) return res.status(400).json({ error: 'Formato de CNPJ inválido.' });
        
        try {
            const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${sanitizedCnpj}`);
            if (!response.ok) return res.status(response.status).json({ error: 'Não localizado.' });
            const data = await response.json();
            
            return res.status(200).json({
                legalName: data.razao_social,
                tradeName: data.nome_fantasia || 'Não informado',
                status: data.descricao_situacao_cadastral,
                foundedAt: data.data_inicio_atividade,
                address: { street: data.logradouro, city: data.municipio, state: data.uf },
                partners: data.socios ? data.socios.map(s => ({ name: s.nome, role: s.qualificacao_socio })) : []
            });
        } catch (error) { 
            return res.status(500).json({ error: 'Erro no servidor ao consultar CNPJ.' }); 
        }
    }

    // --- 2. FILTRO DA ROTA OSINT MASTER ---
    if (url.includes('/api/v1/osint/gamer-profile/')) {
        const param = url.split('/gamer-profile/')[1]?.split('?')[0];
        if (!param) return res.status(400).json({ error: 'Parâmetro de busca vazio.' });

        let username = decodeURIComponent(param).trim();

        // [MÓDULO TIKTOK] - Rastreamento e Extração de metadados de links
        if (username.includes('tiktok.com')) {
            try {
                const tkResponse = await fetch(username, {
                    redirect: 'follow',
                    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15' }
                });

                const urlFinal = tkResponse.url || username;
                const urlObj = new URL(urlFinal);

                const shareUid = urlObj.searchParams.get('share_uid') || 'Não embutido no link';
                const senderDevice = urlObj.searchParams.get('sender_device') || urlObj.searchParams.get('_r') || 'Não detectado';

                return res.status(200).json({
                    username: "Modulo_TikTok_OSINT",
                    scanTime: new Date().toLocaleString('pt-BR'),
                    isTikTokLink: true,
                    tiktok: {
                        urlOriginal: username,
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

        // [MÓDULO TRADICIONAL] - Steam, GitHub e Footprint
        let cleanUserLower = username.toLowerCase();
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
                        let aliasesHistory = [];

                        // Raspagem do histórico de nicks (Atualizado para a estrutura moderna da Steam)
                        try {
                            const profilePageRes = await fetch(`https://steamcommunity.com/profiles/${steamID}`, {
                                headers: { 
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                                }
                            });

                            if (profilePageRes.ok) {
                                const htmlText = await profilePageRes.text();
                                
                                // Técnica 1: Tenta capturar o JSON interno injetado no atributo data-old-aliases
                                const dataAliasesMatch = htmlText.match(/data-old-aliases="([^"]+)"/);
                                
                                if (dataAliasesMatch && dataAliasesMatch[1]) {
                                    const decodedJson = dataAliasesMatch[1]
                                        .replace(/&quot;/g, '"')
                                        .replace(/&#39;/g, "'")
                                        .replace(/&lt;/g, '<')
                                        .replace(/&gt;/g, '>');
                                    
                                    try {
                                        const aliasesArray = JSON.parse(decodedJson);
                                        if (Array.isArray(aliasesArray) && aliasesArray.length > 0) {
                                            aliasesHistory = aliasesArray.map(item => item.newname);
                                        }
                                    } catch (jsonErr) {
                                        console.log("Erro ao decodificar JSON de aliases:", jsonErr.message);
                                    }
                                } 
                                
                                // Técnica 2 (Fallback): Captura via classes de histórico antigas/alternativas caso existam
                                if (aliasesHistory.length === 0) {
                                    const pattern = /<div[^>]*class="[^"]*history_name[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
                                    const matches = [...htmlText.matchAll(pattern)];
                                    
                                    if (matches.length > 0) {
                                        aliasesHistory = matches.map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(Boolean);
                                    }
                                }
                            }
                        } catch (err) { 
                            console.log("Erro na raspagem de nicks:", err.message); 
                        }

                        // Garante uma mensagem amigável se o array de histórico continuar vazio
                        if (aliasesHistory.length === 0) {
                            aliasesHistory = ["Nenhum apelido anterior registrado recentemente ou perfil limpo"];
                        }

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
                            aliasesHistory: aliasesHistory,
                            bioSummary: player.summary || ""
                        };
                    }
                } catch (e) { console.log(e.message); }
            }

            // GITHUB SCAN
            let githubData = { found: false };
            try {
                const ghRes = await fetch(`https://api.github.com/users/${cleanUserLower}`, { headers: { 'User-Agent': 'Node-OSINT-App' } });
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
                { name: "Reddit", url: `https://www.reddit.com/user/${cleanUserLower}`, antiPhrases: ["nobody on reddit", "banned", "404"] },
                { name: "Pinterest", url: `https://www.pinterest.com/${cleanUserLower}/`, antiPhrases: ["resource not found", "404"] },
                { name: "Twitch", url: `https://twitch.tv/${cleanUserLower}`, antiPhrases: ["não encontrado", "404"] },
                { name: "SoundCloud", url: `https://soundcloud.com/${cleanUserLower}`, antiPhrases: ["can't find that user", "404"] }
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

            return res.status(200).json({
                username: cleanUserLower,
                scanTime: new Date().toLocaleString('pt-BR'),
                steam: steamData,
                github: githubData,
                footprint: scanResults,
                manualLinks: {
                    instagram: `https://instagram.com/${cleanUserLower}`,
                    twitterX: `https://x.com/${cleanUserLower}`,
                    youtube: `https://youtube.com/@${cleanUserLower}`
                }
            });

        } catch (error) {
            return res.status(500).json({ error: 'Erro crítico no processamento OSINT.' });
        }
    }

    // Caso acesse a raiz ou rota desconhecida
    return res.status(404).json({ error: 'Rota não encontrada na API.' });
};

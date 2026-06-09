const STEAM_API_KEY = 'C42FF616FEEDAAF0DA435BEFEA17E7A7'; 

module.exports = async (req, res) => {
    // Configuração estrita de CORS para evitar travamentos de requisição
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req;

    try {
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
                return res.status(500).json({ error: 'Erro ao consultar CNPJ.' }); 
            }
        }

        // --- 2. FILTRO DA ROTA OSINT MASTER ---
        if (url.includes('/api/v1/osint/gamer-profile/')) {
            const param = url.split('/gamer-profile/')[1]?.split('?')[0];
            if (!param) return res.status(400).json({ error: 'Parâmetro de busca vazio.' });

            let username = decodeURIComponent(param).trim();

            // [MÓDULO TIKTOK EXCLUSIVO]
            if (username.includes('tiktok.com')) {
                try {
                    const tkResponse = await fetch(username, {
                        method: 'GET',
                        redirect: 'manual', 
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    });

                    let urlFinal = tkResponse.headers.get('location') || username;
                    if (urlFinal.startsWith('/')) {
                        const urlObjBase = new URL(username);
                        urlFinal = urlObjBase.origin + urlFinal;
                    }

                    const pageRes = await fetch(urlFinal, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15' }
                    });
                    
                    const pageHtml = pageRes.ok ? await pageRes.text() : '';
                    const urlObj = new URL(urlFinal);

                    const shareUid = urlObj.searchParams.get('share_uid') || urlObj.searchParams.get('user_id') || 'Não localizado';
                    const senderDevice = urlObj.searchParams.get('sender_device') || urlObj.searchParams.get('_r') || 'Desconhecido';
                    const shareApp = urlObj.searchParams.get('share_app_id') || 'TikTok App';
                    
                    const creatorNameMatch = pageHtml.match(/"authorName":"([^"]+)"/) || pageHtml.match(/<meta property="og:title" content="([^"]+)/);
                    const creatorNickMatch = pageHtml.match(/"uniqueId":"([^"]+)"/) || pageHtml.match(/@([a-zA-Z0-9_\.]+)/);
                    const authorAvatarMatch = pageHtml.match(/"avatarLarger":"([^"]+)"/) || pageHtml.match(/"avatarThumb":"([^"]+)"/);
                    
                    const donoDoVideoNick = creatorNickMatch ? creatorNickMatch[1].split('/')[0] : (urlFinal.split('@')[1]?.split('/')[0] || "Desconhecido");
                    const donoDoVideoNome = creatorNameMatch ? creatorNameMatch[1].split(' no TikTok')[0] : "Não indexado";
                    let donoAvatar = authorAvatarMatch ? authorAvatarMatch[1].replace(/\\u002F/g, '/') : "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";

                    return res.status(200).json({
                        scanTime: new Date().toLocaleString('pt-BR'),
                        isTikTokLink: true,
                        tiktok: {
                            urlOriginal: username,
                            urlExpandida: urlFinal,
                            donoDoVideo: donoDoVideoNick,
                            nomeExibicaoDono: donoDoVideoNome,
                            avatarDono: donoAvatar,
                            videoId: urlFinal.split('/video/')[1]?.split('?')[0] || "Não extraído",
                            vinculoAmigo: {
                                share_uid_remetente: shareUid,
                                device_tracking_code: senderDevice,
                                plataformaOrigem: shareApp,
                                nomeIdentificado: "Conta do Remetente (Token Assinado)",
                                statusAnalise: shareUid !== 'Não localizado' ? "ID Ativo Extraído" : "Nenhum metadado de rastreio encontrado"
                            }
                        }
                    });
                } catch (err) {
                    return res.status(500).json({ error: 'Erro no rastreador do TikTok.', detalhes: err.message });
                }
            }

            // [MÓDULO TRADICIONAL] - Steam, GitHub e Footprint
            let cleanUserLower = username.toLowerCase();
            if (cleanUserLower.includes('steamcommunity.com')) {
                const match = cleanUserLower.match(/(?:id|profiles)\/([a-z0-9_]+)/i);
                if (match && match[1]) cleanUserLower = match[1];
            }
            cleanUserLower = cleanUserLower.replace('@', '').replace(/\//g, '').trim();

            if (!cleanUserLower) return res.status(400).json({ error: 'Nickname inválido.' });

            let steamData = { found: false, gamesList: [], aliasesHistory: [] };
            let steamID = null;

            if (/^\d+$/.test(cleanUserLower) && cleanUserLower.length >= 16) {
                steamID = cleanUserLower;
            } else {
                try {
                    const resolveRes = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${cleanUserLower}`);
                    const resolveData = await resolveRes.json();
                    if (resolveData.response && resolveData.response.success === 1) steamID = resolveData.response.steamid;
                } catch (e) {}
            }

            if (steamID) {
                try {
                    const userRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamID}`);
                    const userData = await userRes.json();

                    if (userData.response && userData.response.players && userData.response.players.length > 0) {
                        const player = userData.response.players[0];
                        const isPublic = player.communityvisibilitystate === 3;
                        let aliasesHistory = [];

                        // Capturador Resiliente de Apelidos Antigos
                        try {
                            const profilePageRes = await fetch(`https://steamcommunity.com/profiles/${steamID}`, {
                                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                            });
                            if (profilePageRes.ok) {
                                const htmlText = await profilePageRes.text();
                                const scriptAliasMatch = htmlText.match(/UserYouAreViewing\.SetOldAliases\(\s*(\[[ \t]*\{[\s\S]*?\}]);/);
                                if (scriptAliasMatch && scriptAliasMatch[1]) {
                                    aliasesHistory = JSON.parse(scriptAliasMatch[1]).map(i => i.newname);
                                }
                                if (aliasesHistory.length === 0) {
                                    const rawBlockMatches = htmlText.match(/class="prev_profile_name">([\s\S]*?)<\/span>/g);
                                    if (rawBlockMatches) aliasesHistory = rawBlockMatches.map(m => m.replace(/<[^>]*>/g, '').trim());
                                }
                            }
                        } catch (e) {}

                        if (aliasesHistory.length === 0) aliasesHistory = ["Nenhum histórico de alteração de nick gravado recente"];

                        let gamesList = [];
                        let gameCount = "Oculto/Privado";
                        let recentPlaytime = "Oculto/Privado";

                        if (isPublic) {
                            try {
                                const gamesRes = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamID}&include_appinfo=1`);
                                const gamesData = await gamesRes.json();
                                if (gamesData.response && gamesData.response.games) {
                                    gameCount = `${gamesData.response.game_count} jogos detectados`;
                                    gamesList = gamesData.response.games.map(g => ({ name: g.name, playtime: `${Math.round(g.playtime_forever / 60)} horas` }));
                                }
                            } catch(e){}
                        }

                        steamData = {
                            found: true, steamID, personaName: player.personaname, realName: player.realname || "Não exposto",
                            avatar: player.avatarfull, country: player.loccountrycode || "Não informado",
                            privacy: isPublic ? "🟢 PERFIL PÚBLICO" : "🔴 PERFIL PRIVADO", status: player.personastate === 0 ? "Offline" : "Online",
                            gameCount, recentPlaytime, gamesList, aliasesHistory
                        };
                    }
                } catch (e) {}
            }

            // GITHUB SCAN
            let githubData = { found: false };
            try {
                const ghRes = await fetch(`https://api.github.com/users/${cleanUserLower}`, { headers: { 'User-Agent': 'Node-OSINT' } });
                if (ghRes.ok) {
                    const gh = await ghRes.json();
                    githubData = { found: true, name: gh.name || "Não informado", bio: gh.bio || "Sem bio", publicRepos: gh.public_repos, email: gh.email || "Não exposto" };
                }
            } catch (e) {}

            // FOOTPRINT ASYNC PARALELO (Evita estourar o timeout da Vercel)
            const networks = [
                { name: "Reddit", url: `https://www.reddit.com/user/${cleanUserLower}`, anti: "nobody on reddit" },
                { name: "Pinterest", url: `https://www.pinterest.com/${cleanUserLower}/`, anti: "resource not found" },
                { name: "Twitch", url: `https://twitch.tv/${cleanUserLower}`, anti: "não encontrado" }
            ];

            const scanResults = await Promise.all(networks.map(async (net) => {
                try {
                    const r = await fetch(net.url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' } });
                    if (r.status === 200) {
                        const text = await r.text();
                        const isFake = text.toLowerCase().includes(net.anti);
                        return { name: net.name, status: isFake ? "NÃO IDENTIFICADO" : "LOCALIZADO", link: net.url, badge: isFake ? "badge-danger" : "badge-success" };
                    }
                    return { name: net.name, status: "NÃO IDENTIFICADO", link: net.url, badge: "badge-danger" };
                } catch (e) {
                    return { name: net.name, status: "NÃO IDENTIFICADO", link: net.url, badge: "badge-danger" };
                }
            }));

            return res.status(200).json({
                username: cleanUserLower,
                scanTime: new Date().toLocaleString('pt-BR'),
                isTikTokLink: false,
                steam: steamData,
                github: githubData,
                footprint: scanResults,
                manualLinks: { instagram: `https://instagram.com/${cleanUserLower}`, twitterX: `https://x.com/${cleanUserLower}`, youtube: `https://youtube.com/@${cleanUserLower}` }
            });
        }

        return res.status(404).json({ error: 'Rota inválida.' });

    } catch (criticalError) {
        // ESSA LINHA DIZ: Nunca solte texto puro, sempre retorne JSON estruturado e impeça o "Unexpected Token A"
        return res.status(500).json({ error: 'Erro interno crítico no servidor.', detalhes: criticalError.message });
    }
};

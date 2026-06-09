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

        // [MÓDULO TIKTOK EXCLUSIVO] - Extração Avançada de Metadados de Link e Remetente
        if (username.includes('tiktok.com')) {
            try {
                const tkResponse = await fetch(username, {
                    method: 'GET',
                    redirect: 'manual', 
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                    }
                });

                let urlFinal = tkResponse.headers.get('location') || username;
                
                if (urlFinal.startsWith('/')) {
                    const urlObjBase = new URL(username);
                    urlFinal = urlObjBase.origin + urlFinal;
                }

                const pageRes = await fetch(urlFinal, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' }
                });
                
                const pageHtml = pageRes.ok ? await pageRes.text() : '';
                const urlObj = new URL(urlFinal);

                // Captura de IDs de rastreamento do Remetente (Quem gerou o link de envio)
                const shareUid = urlObj.searchParams.get('share_uid') || urlObj.searchParams.get('user_id') || 'Não embutido na URL (Copiado de forma limpa pelo browser)';
                const senderDevice = urlObj.searchParams.get('sender_device') || urlObj.searchParams.get('_r') || 'Não detectado';
                const shareApp = urlObj.searchParams.get('share_app_id') || 'TikTok Mobile App';
                
                // Extração Cirúrgica do Criador do Conteúdo via Metatags do DOM do TikTok
                const creatorNameMatch = pageHtml.match(/"authorName":"([^"]+)"/) || pageHtml.match(/<meta property="og:title" content="([^"]+)/);
                const creatorNickMatch = pageHtml.match(/"uniqueId":"([^"]+)"/) || pageHtml.match(/@([a-zA-Z0-9_\.]+)/);
                const authorAvatarMatch = pageHtml.match(/"avatarLarger":"([^"]+)"/) || pageHtml.match(/"avatarThumb":"([^"]+)"/);
                
                const donoDoVideoNick = creatorNickMatch ? creatorNickMatch[1].split('/')[0] : (urlFinal.split('@')[1]?.split('/')[0] || "Desconhecido");
                const donoDoVideoNome = creatorNameMatch ? creatorNameMatch[1].split(' no TikTok')[0] : "Não indexado";
                let donoAvatar = authorAvatarMatch ? authorAvatarMatch[1].replace(/\\u002F/g, '/') : "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";

                let dadosRemetente = {
                    nickname: "Conta do Remetente (Assinatura do Token)",
                    status: shareUid !== null && !shareUid.includes('Não') ? "ID Ativo Localizado na URL" : "Indisponível (Sem metadados de compartilhamento originários)"
                };

                return res.status(200).json({
                    username: "Modulo_TikTok_OSINT_Pro",
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
                            nomeIdentificado: dadosRemetente.nickname,
                            statusAnalise: dadosRemetente.status
                        }
                    }
                });
            } catch (err) {
                return res.status(500).json({ error: 'Erro de engenharia ao desmembrar metadados do TikTok.', detalhes: err.message });
            }
        }

        // [MÓDULO TRADICIONAL] - Steam, GitHub e Footprint de Redes Sociais
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

                        // NOVO MOTOR DE RASPAGEM DE NICKS DA STEAM (Varredura Multicamadas)
                        try {
                            const profilePageRes = await fetch(`https://steamcommunity.com/profiles/${steamID}`, {
                                headers: { 
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                                }
                            });

                            if (profilePageRes.ok) {
                                const htmlText = await profilePageRes.text();
                                
                                // Camada 1: Script global populado pelo motor interno da Valve
                                const scriptAliasMatch = htmlText.match(/UserYouAreViewing\.SetOldAliases\(\s*(\[[ \t]*\{[\s\S]*?\}]);/);
                                if (scriptAliasMatch && scriptAliasMatch[1]) {
                                    try {
                                        const parsed = JSON.parse(scriptAliasMatch[1]);
                                        aliasesHistory = parsed.map(item => item.newname);
                                    } catch(e){}
                                }

                                // Camada 2: Fallback por classes clássicas do histórico
                                if (aliasesHistory.length === 0) {
                                    const rawBlockMatches = htmlText.match(/class="prev_profile_name">([\s\S]*?)<\/span>/g) || htmlText.match(/<div[^>]*class="[^"]*history_name[^"]*"[^>]*>([\s\S]*?)<\/div>/g);
                                    if (rawBlockMatches) {
                                        aliasesHistory = rawBlockMatches.map(m => m.replace(/<[^>]*>/g, '').trim()).filter(Boolean);
                                    }
                                }

                                // Camada 3: Varredura por blocos JSON de ViewState injetados
                                if (aliasesHistory.length === 0) {
                                    const dataAliasesMatch = htmlText.match(/data-old-aliases="([^"]+)"/);
                                    if (dataAliasesMatch && dataAliasesMatch[1]) {
                                        const decodedJson = dataAliasesMatch[1].replace(/&quot;/g, '"');
                                        try {
                                            aliasesHistory = JSON.parse(decodedJson).map(i => i.newname);
                                        } catch(e){}
                                    }
                                }
                            }
                        } catch (err) { 
                            console.log("Falha no Crawler de Nicks Antigos:", err.message); 
                        }

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
                isTikTokLink: false,
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

    return res.status(404).json({ error: 'Rota não encontrada na API.' });
};

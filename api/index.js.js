const STEAM_API_KEY = 'C42FF616FEEDAAF0DA435BEFEA17E7A7'; 

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    const { url } = req;

    // --- 1. ROTA DE CNPJ ---
    if (url.includes('/api/v1/corporate/')) {
        const cnpj = url.split('/corporate/')[1]?.split('?')[0];
        if (!cnpj) return res.status(400).json({ error: 'CNPJ não informado.' });
        const sanitizedCnpj = cnpj.replace(/\D/g, '');
        
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
        } catch (error) { return res.status(500).json({ error: 'Erro ao consultar CNPJ.' }); }
    }

    // --- 2. ROTA OSINT MASTER ---
    if (url.includes('/api/v1/osint/gamer-profile/')) {
        const param = url.split('/gamer-profile/')[1]?.split('?')[0];
        if (!param) return res.status(400).json({ error: 'Parâmetro vazio.' });

        let username = decodeURIComponent(param).trim();

        // [MÓDULO TIKTOK EXCLUSIVO]
        if (username.includes('tiktok.com')) {
            try {
                // Resolve links encurtados mantendo cookies simulados
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
                    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' }
                });
                const pageHtml = pageRes.ok ? await pageRes.text() : '';
                const urlObj = new URL(urlFinal);

                // Tokens de Rastreamento (Identificação Base do Remetente)
                const shareUid = urlObj.searchParams.get('share_uid') || urlObj.searchParams.get('user_id') || null;
                const senderDevice = urlObj.searchParams.get('sender_device') || urlObj.searchParams.get('_r') || 'Desconhecido';
                
                // Extração do Dono do Vídeo (Autor)
                const creatorNickMatch = pageHtml.match(/"uniqueId":"([^"]+)"/) || pageHtml.match(/@([a-zA-Z0-9_\.]+)/);
                const creatorNameMatch = pageHtml.match(/"authorName":"([^"]+)"/) || pageHtml.match(/<meta property="og:title" content="([^"]+)/);
                const authorAvatarMatch = pageHtml.match(/"avatarLarger":"([^"]+)"/) || pageHtml.match(/"avatarThumb":"([^"]+)"/);

                const donoNick = creatorNickMatch ? creatorNickMatch[1].split('/')[0] : "Desconhecido";
                const donoNome = creatorNameMatch ? creatorNameMatch[1].split(' no TikTok')[0] : "Não indexado";
                const donoAvatar = authorAvatarMatch ? authorAvatarMatch[1].replace(/\\u002F/g, '/') : "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp";

                // Investigação Avançada do Remetente (Quem enviou) via Endpoints Públicos de Rastreamento
                let dadosRemetente = {
                    id: shareUid || "Não embutido na URL (Link limpo)",
                    username: "Não decodificado (Requer login de sessão)",
                    nickname: "Conta que gerou o token",
                    status: shareUid ? "ID Localizado no Token de Compartilhamento" : "Indisponível (Copiado via Browser/Sem Vinculo)"
                };

                if (shareUid) {
                    try {
                        // Faz uma busca indireta na tentativa de capturar dados públicos associados ao ID de rastreio
                        const senderFetch = await fetch(`https://www.tiktok.com/node/share/user/@id:${shareUid}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        });
                        if (senderFetch.ok) {
                            const senderHtml = await senderFetch.text();
                            const sName = senderHtml.match(/"nickname":"([^"]+)"/);
                            if (sName) dadosRemetente.nickname = sName[1];
                        }
                    } catch(e){}
                }

                // Retorna um JSON tipado estruturalmente diferente para o Frontend notar
                return res.status(200).json({
                    isTikTokLink: true,
                    scanTime: new Date().toLocaleString('pt-BR'),
                    videoData: {
                        urlOriginal: username,
                        urlExpandida: urlFinal,
                        videoId: urlFinal.split('/video/')[1]?.split('?')[0] || "Não extraído",
                        autor: {
                            username: donoNick,
                            nome: donoNome,
                            avatar: donoAvatar
                        }
                    },
                    remetente: {
                        uid: dadosRemetente.id,
                        dispositivo: senderDevice,
                        nomeIdentificado: dadosRemetente.nickname,
                        statusAnalise: dadosRemetente.status
                    }
                });

            } catch (err) {
                return res.status(500).json({ error: 'Falha crítica ao rastrear link do TikTok.', detalhes: err.message });
            }
        }

        // [MÓDULO TRADICIONAL GAMER]
        let cleanUserLower = username.toLowerCase().replace('@', '').replace(/\//g, '').trim();
        try {
            let steamData = { found: false, gamesList: [], aliasesHistory: [] };
            let steamID = null;

            if (/^\d+$/.test(cleanUserLower) && cleanUserLower.length >= 16) {
                steamID = cleanUserLower;
            } else {
                const resolveRes = await fetch(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${cleanUserLower}`);
                const resolveData = await resolveRes.json();
                if (resolveData.response && resolveData.response.success === 1) steamID = resolveData.response.steamid;
            }

            if (steamID) {
                const userRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamID}`);
                const userData = await userRes.json();

                if (userData.response && userData.response.players && userData.response.players.length > 0) {
                    const player = userData.response.players[0];
                    const isPublic = player.communityvisibilitystate === 3;
                    let aliasesHistory = [];

                    // Captura agressiva de nicks antigos
                    try {
                        const profilePageRes = await fetch(`https://steamcommunity.com/profiles/${steamID}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36', 'Accept-Language': 'pt-BR,pt' }
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
                    } catch (e){}

                    if (aliasesHistory.length === 0) aliasesHistory = ["Nenhum histórico armazenado ou perfil limpo"];

                    let gamesList = [];
                    let gameCount = "Privado";
                    if (isPublic) {
                        const gamesRes = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamID}&include_appinfo=1`);
                        const gamesData = await gamesRes.json();
                        if (gamesData.response && gamesData.response.games) {
                            gameCount = `${gamesData.response.game_count} jogos`;
                            gamesList = gamesData.response.games.map(g => ({ name: g.name, playtime: `${Math.round(g.playtime_forever / 60)}h` }));
                        }
                    }

                    steamData = {
                        found: true, steamID, personaName: player.personaname, realName: player.realname || "Não informado",
                        avatar: player.avatarfull, country: player.loccountrycode || "Não informado",
                        privacy: isPublic ? "🟢 PERFIL PÚBLICO" : "🔴 PERFIL PRIVADO", status: player.personastate === 0 ? "Offline" : "Online",
                        gameCount, gamesList, aliasesHistory
                    };
                }
            }

            return res.status(200).json({
                isTikTokLink: false, username: cleanUserLower, steam: steamData,
                footprint: [], manualLinks: { instagram: `https://instagram.com/${cleanUserLower}`, twitterX: `https://x.com/${cleanUserLower}` }
            });
        } catch (e) { return res.status(500).json({ error: 'Erro no processamento OSINT.' }); }
    }
    return res.status(404).json({ error: 'Rota não encontrada.' });
};

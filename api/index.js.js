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

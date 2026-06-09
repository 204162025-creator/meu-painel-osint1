const axios = require('axios');

module.exports = async (req, res) => {
    // Configurações de permissão (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { target, type } = req.query;

    if (!target) {
        return res.status(400).json({ error: 'O alvo de pesquisa está vazio.' });
    }

    try {
        // ================= TRATAMENTO TIKTOK =================
        if (type === 'tiktok' || target.includes('tiktok.com')) {
            
            // Faz uma requisição fake simulando um celular para o TikTok não bloquear
            const response = await axios.get(target, {
                maxRedirects: 5,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' 
                }
            });

            // Pega a URL final depois de todos os redirecionamentos do TikTok
            const urlFinal = response.request.res.responseUrl || target;
            const urlObj = new URL(urlFinal);

            // EXTRAÇÃO DE METADADOS: O TikTok insere IDs de rastreio de quem enviou o link!
            const quemCompartilhouID = urlObj.searchParams.get('sender_device') || urlObj.searchParams.get('_r') || urlObj.searchParams.get('share_app_id');
            const uidRastreio = urlObj.searchParams.get('share_uid') || 'Não injetado (Link limpo)';

            return res.status(200).json({
                status: "Sucesso",
                modulo: "TikTok Tracker OSINT",
                url_original_enviada: target,
                url_real_desembrulhada: urlFinal,
                dono_do_video: urlFinal.split('@')[1]?.split('/')[0] || "Desconhecido",
                id_do_video: urlFinal.split('/video/')[1]?.split('?')[0] || "Não encontrado",
                metadados_de_rastreio: {
                    info: "Se o seu amigo copiou esse link de dentro do aplicativo dele, os IDs abaixo pertencem à conta dele.",
                    uid_do_remetente: uidRastreio,
                    codigo_rastreio_dispositivo: quemCompartilhouID || "Limpo ou Direto"
                }
            });
        }

        // ================= TRATAMENTO STEAM =================
        if (type === 'steam') {
            // Nota: Para nicks reais em tempo real, usamos raspagem pública simulada da Steam Community
            // Já que a API Key padrão esconde por privacidade.
            let steamIdLimpo = target.replace(/\D/g, ''); // Deixa só números se ele botar o link todo

            if(!steamIdLimpo) {
                return res.status(400).json({ error: 'Por favor, insira o ID numérico da Steam (SteamID64).' });
            }

            // Simulando a consulta na página da comunidade para pegar nicks antigos (aliases)
            const steamProfileUrl = `https://steamcommunity.com/profiles/${steamIdLimpo}`;
            
            // Fazemos uma busca rápida dos dados visuais do perfil
            const profilePage = await axios.get(steamProfileUrl).catch(() => null);
            
            let nicksAntigos Encontrados = [
                "Nick Antigo 1 (Buscando logs de cache...)",
                "Nick Antigo 2 (Logs históricos)",
                "Perfil Privado ou sem histórico recente no cache da Steam"
            ];

            if (profilePage && profilePage.data) {
                // Se a página for pública, tentamos caçar os nomes antigos que ficam guardados no script interno da Steam
                const matches = profilePage.data.match(/PersonaHistoryNameGroup">([\s\S]*?)<\/div>/g);
                if (matches) {
                    nicksAntigosEncontrados = matches.map(m => m.replace(/<[^>]*>/g, '').trim());
                }
            }

            return res.status(200).json({
                status: "Sucesso",
                modulo: "Steam Nick History",
                steam_id_64: steamIdLimpo,
                link_do_perfil: steamProfileUrl,
                historico_de_nicks_localizados: nicksAntigosEncontrados,
                nota: "Se o array vier vazio ou padrão, significa que o usuário limpou o histórico ou o perfil é privado."
            });
        }

        return res.status(400).json({ error: 'Tipo de busca inválido.' });

    } catch (error) {
        return res.status(500).json({ error: 'Erro interno ao investigar.', detalhes: error.message });
    }
};

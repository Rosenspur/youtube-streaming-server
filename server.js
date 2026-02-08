const express = require('express');
const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const app = express();

app.use(express.json());

// --- 1. BÚSQUEDA DE VIDEO ID ---
async function searchYouTube(query) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url);
        const match = data.match(/"videoId":"([^"]+)"/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}

// --- 2. MANEJADOR DE ALEXA (LA ORDEN) ---
app.post('/', async (req, res) => {
    const requestType = req.body.request.type;
    
    if (requestType === 'LaunchRequest') {
        return res.json(createResponse("YouTube listo. ¿Qué canción buscamos?"));
    }

    if (requestType === 'IntentRequest' && req.body.request.intent.name === 'PlayVideoIntent') {
        const query = req.body.request.intent.slots.VideoQuery.value;
        const videoId = await searchYouTube(query);

        if (!videoId) return res.json(createResponse("No encontré el video."));

        // IMPORTANTE: La URL que le damos a Alexa apunta a NUESTRO servidor, no a YT
        const myServerUrl = `https://${req.headers.host}/stream/${videoId}`;

        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "PlainText", text: `Entendido, tocando ${query}` },
                directives: [{
                    type: "AudioPlayer.Play",
                    playBehavior: "REPLACE_ALL",
                    audioItem: {
                        stream: {
                            url: myServerUrl, // Alexa le pedirá el audio a tu Railway
                            token: videoId,
                            offsetInMilliseconds: 0
                        }
                    }
                }],
                shouldEndSession: true
            }
        });
    }
});

// --- 3. EL TÚNEL DE AUDIO (EL FILTRO) ---
// Aquí es donde ocurre la magia: Railway descarga y entrega el audio a la vez
app.get('/stream/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    console.log(`[TÚNEL] Procesando audio para: ${videoId}`);

    try {
        const options = {
            filter: 'audioonly',
            quality: 'highestaudio',
            requestOptions: {
                headers: {
                    // Usamos tus cookies para que YouTube crea que somos un humano
                    cookie: process.env.YOUTUBE_COOKIES || '' 
                }
            }
        };

        // Configuramos la respuesta como audio
        res.setHeader('Content-Type', 'audio/mpeg');
        
        // ytdl descarga -> pipe lo envía a Alexa en tiempo real
        ytdl(videoUrl, options).pipe(res);

    } catch (error) {
        console.error(`[ERROR TÚNEL] ${error.message}`);
        res.status(500).send("Error en el puente de audio");
    }
});

function createResponse(text) {
    return { version: "1.0", response: { outputSpeech: { type: "PlainText", text: text }, shouldEndSession: false } };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Túnel activo en puerto ${PORT}`));
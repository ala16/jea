'use strict';

// Armazenamento de fotos e anexos.
// Com BLOB_READ_WRITE_TOKEN (Vercel Blob) o navegador envia o arquivo direto para o Blob.
// Sem ele, os arquivos ficam em disco (UPLOAD_DIR), para uso local.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MAX_BYTES = 5 * 1024 * 1024;
const usaBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'data', 'uploads');
const EXT_IMAGEM = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i;
const URL_BLOB = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[^?#]+$/i;
const URL_LOCAL = /^\/arquivos\/[\w.-]+$/;

function ehImagem(url) {
  return EXT_IMAGEM.test(url);
}

function urlValida(url) {
  if (usaBlob) return URL_BLOB.test(url);
  return URL_LOCAL.test(url) && fs.existsSync(caminhoLocal(path.basename(url)));
}

function caminhoLocal(nome) {
  return path.join(UPLOAD_DIR, path.basename(nome));
}

async function remover(url) {
  try {
    if (URL_BLOB.test(url) && usaBlob) await require('@vercel/blob').del(url);
    else if (URL_LOCAL.test(url)) fs.unlinkSync(caminhoLocal(url));
  } catch (e) {
    console.warn('[aviso] não foi possível remover', url, e.message);
  }
}

// Gera o token para o navegador enviar direto ao Vercel Blob (req já autenticado por CPF).
async function gerarTokenBlob(req) {
  if (!usaBlob) throw Object.assign(new Error('Upload direto não configurado.'), { status: 400 });
  const { handleUpload } = require('@vercel/blob/client');
  return handleUpload({
    body: req.body,
    request: req,
    onBeforeGenerateToken: async (pathname, clientPayload) => ({
      allowedContentTypes: clientPayload === 'imagem' || EXT_IMAGEM.test(pathname) ? ['image/*'] : undefined,
      maximumSizeInBytes: MAX_BYTES,
      addRandomSuffix: true,
    }),
  });
}

// Upload local (sem Vercel Blob): recebe multipart com o campo "arquivo".
let multerLocal;
function uploadLocal(req, res, next) {
  if (usaBlob) return res.status(400).json({ erro: 'Use o upload direto.' });
  if (!multerLocal) {
    const multer = require('multer');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    multerLocal = multer({
      storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (r, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
          cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
        },
      }),
      limits: { fileSize: MAX_BYTES },
    }).single('arquivo');
  }
  multerLocal(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    res.json({ url: `/arquivos/${req.file.filename}`, nome: req.file.originalname });
  });
}

module.exports = { usaBlob, ehImagem, urlValida, caminhoLocal, remover, gerarTokenBlob, uploadLocal };

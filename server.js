require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = 3001;

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP
  message: { error: 'Demasiadas solicitudes, intenta más tarde' },
  standardHeaders: true,
  legacyHeaders: false
});

// CORS específico
const corsOptions = {
  origin: [
    'http://localhost:4200',
    'http://localhost:3000',
    'http://127.0.0.1:4200',
    'http://127.0.0.1:3000',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true,
  optionsSuccessStatus: 200
};

// API Key middleware
const apiKeyAuth = (req, res, next) => {
  // Excluir endpoint de salud de autenticación
  if (req.path === '/api/health') {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY;
  
  if (!validApiKey) {
    console.warn('⚠️  API_KEY no configurada en variables de entorno');
    return next(); // Continuar sin autenticación si no está configurada
  }
  
  if (!apiKey || apiKey !== validApiKey) {
    return res.status(401).json({ 
      success: false, 
      error: 'API Key requerida o inválida' 
    });
  }
  
  next();
};

// Middleware
app.use(limiter);
app.use(cors(corsOptions));
app.use(express.json());
app.use(apiKeyAuth);

// Ruta del archivo JSON configurable por variable de entorno
const invitadosPath = process.env.INVITADOS_PATH || path.join(__dirname, 'invitados', 'invitados.json');

// Endpoint para actualizar invitados
app.post('/api/update-invitados', (req, res) => {
  try {
    const { content } = req.body;
    
    // Escribir el contenido al archivo
    fs.writeFileSync(invitadosPath, content, 'utf8');
    
    console.log('✅ Archivo invitados.json actualizado');
    res.json({ success: true, message: 'Archivo actualizado correctamente' });
  } catch (error) {
    console.error('❌ Error al actualizar archivo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para obtener datos de invitados
app.get('/api/invitados', (req, res) => {
  try {
    if (fs.existsSync(invitadosPath)) {
      const data = fs.readFileSync(invitadosPath, 'utf8');
      res.json(JSON.parse(data));
    } else {
      // Crear archivo inicial si no existe
      const initialData = {
        familiasConfirmadas: [],
        familiasRechazadas: [],
        intentosPorFamilia: {},
        contadores: {
          familiasConfirmadas: 0,
          familiasRechazadas: 0,
          totalInvitadosConfirmados: 0,
          totalInvitadosRechazados: 0
        },
        ultimaActualizacion: new Date().toISOString()
      };
      
      fs.writeFileSync(invitadosPath, JSON.stringify(initialData, null, 2));
      res.json(initialData);
    }
  } catch (error) {
    console.error('❌ Error al leer archivo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para procesar confirmación/rechazo
app.post('/api/process-rsvp', (req, res) => {
  try {
    const { familyName, maxGuests, attendingGuests, status } = req.body;
    const clientIP = req.ip || req.connection.remoteAddress;
    console.log('IP del cliente:', clientIP);
    
    // Leer datos actuales
    let data = {};
    if (fs.existsSync(invitadosPath)) {
      data = JSON.parse(fs.readFileSync(invitadosPath, 'utf8'));
    } else {
      data = {
        familiasConfirmadas: [],
        familiasRechazadas: [],
        intentosPorFamilia: {},
        contadores: { familiasConfirmadas: 0, familiasRechazadas: 0, totalInvitadosConfirmados: 0, totalInvitadosRechazados: 0 },
        ultimaActualizacion: new Date().toISOString()
      };
    }
    
    // Normalizar nombre
    const normalizedName = familyName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    
    // Verificar límite de intentos
    if (!data.intentosPorFamilia) data.intentosPorFamilia = {};
    const currentAttempts = data.intentosPorFamilia[normalizedName] || 0;
    
    if (currentAttempts >= 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'Esta familia ya ha realizado el máximo de 3 actualizaciones permitidas.' 
      });
    }
    
    // Buscar y eliminar familia existente
    const confirmedIndex = data.familiasConfirmadas.findIndex(f => 
      f.familia.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() === normalizedName
    );
    const rejectedIndex = data.familiasRechazadas.findIndex(f => 
      f.familia.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() === normalizedName
    );
    
    if (confirmedIndex !== -1) data.familiasConfirmadas.splice(confirmedIndex, 1);
    if (rejectedIndex !== -1) data.familiasRechazadas.splice(rejectedIndex, 1);
    
    // Agregar nueva entrada
    const familyData = {
      familia: familyName,
      invitados: status === 'CONFIRMADO' ? attendingGuests : maxGuests,
      fecha: new Date().toISOString()
    };
    
    if (status === 'CONFIRMADO') {
      data.familiasConfirmadas.push(familyData);
    } else {
      data.familiasRechazadas.push(familyData);
    }
    
    // Incrementar contador de intentos
    data.intentosPorFamilia[normalizedName] = currentAttempts + 1;
    
    // Recalcular contadores
    data.contadores = {
      familiasConfirmadas: data.familiasConfirmadas.length,
      familiasRechazadas: data.familiasRechazadas.length,
      totalInvitadosConfirmados: data.familiasConfirmadas.reduce((sum, f) => sum + f.invitados, 0),
      totalInvitadosRechazados: data.familiasRechazadas.reduce((sum, f) => sum + f.invitados, 0)
    };
    
    data.ultimaActualizacion = new Date().toISOString();
    
    // Guardar archivo
    fs.writeFileSync(invitadosPath, JSON.stringify(data, null, 2));
    
    console.log(`✅ ${status}: ${familyName} (${familyData.invitados} invitados)`);
    
    res.json({ 
      success: true, 
      message: status === 'CONFIRMADO' ? 
        `¡Tu solicitud ha sido enviada correctamente! Gracias familia ${familyName}.` :
        'Tu solicitud ha sido enviada correctamente. Lamentamos que no puedan acompañarnos.',
      data: data.contadores
    });
    
  } catch (error) {
    console.error('❌ Error al procesar RSVP:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// Endpoint para generar PDF
app.get('/api/generate-pdf', (req, res) => {
  try {
    if (!fs.existsSync(invitadosPath)) {
      return res.status(404).json({ success: false, message: 'No hay datos de invitados' });
    }

    const data = JSON.parse(fs.readFileSync(invitadosPath, 'utf8'));
    const doc = new PDFDocument({ margin: 40 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="invitados-reporte.pdf"');
    
    doc.pipe(res);
    
    // Función para dibujar tabla
    function drawTable(doc, headers, rows, startY, title) {
      const tableTop = startY;
      const itemHeight = 25;
      const colWidths = [40, 200, 80, 120, 100];
      let currentY = tableTop;
      
      // Título de la sección
      doc.fontSize(16).fillColor('#2c3e50').text(title, 40, currentY - 30);
      
      // Encabezados
      doc.rect(40, currentY, 540, itemHeight).fillAndStroke('#3498db', '#2c3e50');
      doc.fontSize(11).fillColor('white');
      let currentX = 40;
      headers.forEach((header, i) => {
        doc.text(header, currentX + 5, currentY + 8, { width: colWidths[i] - 10 });
        currentX += colWidths[i];
      });
      
      currentY += itemHeight;
      
      // Filas
      rows.forEach((row, index) => {
        const fillColor = index % 2 === 0 ? '#ecf0f1' : 'white';
        doc.rect(40, currentY, 540, itemHeight).fillAndStroke(fillColor, '#bdc3c7');
        
        doc.fontSize(10).fillColor('#2c3e50');
        currentX = 40;
        row.forEach((cell, i) => {
          doc.text(cell, currentX + 5, currentY + 8, { width: colWidths[i] - 10 });
          currentX += colWidths[i];
        });
        
        currentY += itemHeight;
        
        if (currentY > 720) {
          doc.addPage();
          currentY = 50;
        }
      });
      
      return currentY + 30;
    }
    
    // Título principal
    const eventName = process.env.NOMBRE_EVENTO || '';
    const title = eventName ? `Invitados - ${eventName}` : 'Invitados';
    doc.fontSize(24).fillColor('#2c3e50').text(title, 40, 40);
    doc.fontSize(12).fillColor('#7f8c8d').text(`Generado: ${new Date().toLocaleString('es-ES')}`, 40, 75);
    
    // Resumen en cajas
    let y = 120;
    const boxWidth = 120;
    const boxHeight = 60;
    const boxes = [
      { label: 'Familias confirmadas', value: data.contadores.familiasConfirmadas, color: '#27ae60' },
      { label: 'Familias no confirmadas', value: data.contadores.familiasRechazadas, color: '#e74c3c' },
      { label: 'Personas confirmadas', value: data.contadores.totalInvitadosConfirmados, color: '#3498db' },
      { label: 'Personas que No Asisten', value: data.contadores.totalInvitadosRechazados, color: '#f39c12' }
    ];
    
    boxes.forEach((box, i) => {
      const x = 40 + (i * (boxWidth + 20));
      doc.rect(x, y, boxWidth, boxHeight).fillAndStroke(box.color, box.color);
      doc.fontSize(20).fillColor('white').text(box.value.toString(), x + 10, y + 10);
      doc.fontSize(10).fillColor('white').text(box.label, x + 10, y + 35);
    });
    
    y += 100;
    
    // Tabla de Familias Confirmadas
    if (data.familiasConfirmadas.length > 0) {
      const headers = ['#', 'Familia', 'Invitados', 'Fecha', 'Estado'];
      const rows = data.familiasConfirmadas.map((familia, index) => [
        (index + 1).toString(),
        familia.familia,
        familia.invitados.toString(),
        new Date(familia.fecha).toLocaleDateString('es-ES'),
        'Confirmado'
      ]);
      
      y = drawTable(doc, headers, rows, y, 'Familias Confirmadas');
    }
    
    // Tabla de Familias Rechazadas
    if (data.familiasRechazadas.length > 0) {
      if (y > 600) {
        doc.addPage();
        y = 50;
      }
      
      const headers = ['#', 'Familia', 'Invitados', 'Fecha', 'Estado'];
      const rows = data.familiasRechazadas.map((familia, index) => [
        (index + 1).toString(),
        familia.familia,
        familia.invitados.toString(),
        new Date(familia.fecha).toLocaleDateString('es-ES'),
        'Rechazado'
      ]);
      
      y = drawTable(doc, headers, rows, y, 'Familias Rechazadas');
    }
    
    // Pie de página
    doc.fontSize(8).fillColor('#95a5a6')
       .text(`Última actualización: ${new Date(data.ultimaActualizacion).toLocaleString('es-ES')}`, 40, doc.page.height - 50);
    
    doc.end();
    
  } catch (error) {
    console.error('❌ Error al generar PDF:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para obtener configuración del evento
app.get('/api/event-config', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config', 'event-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      res.json(config);
    } else {
      res.status(404).json({ success: false, message: 'Configuración no encontrada' });
    }
  } catch (error) {
    console.error('❌ Error al leer configuración:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend ejecutándose en http://localhost:${PORT}`);
  console.log(`📁 Archivo de invitados: ${invitadosPath}`);
});
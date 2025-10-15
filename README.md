# Backend - Invitación Digital

Backend simple para manejar la actualización del archivo `invitados.json`.

## Instalación

```bash
cd backend
npm install
```

## Ejecución

```bash
# Modo desarrollo (con auto-reload)
npm run dev

# Modo producción
npm start
```

## Endpoints

- `POST /api/update-invitados` - Actualiza el archivo invitados.json
- `GET /api/invitados` - Obtiene los datos actuales
- `GET /api/health` - Estado del servidor

## Uso

1. Ejecutar el backend: `npm run dev`
2. Ejecutar Angular: `npm start` (en la carpeta invitacion-digital)
3. El archivo `invitados.json` se actualizará automáticamente

## Puerto

El backend se ejecuta en `http://localhost:3001`
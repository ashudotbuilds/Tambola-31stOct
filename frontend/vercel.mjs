// Vercel evaluates this at deployment time. Keep the backend origin in the
// existing environment variable while cookies stay on the frontend domain.
const backend = new URL(process.env.VITE_API_URL || '')
if (!['http:', 'https:'].includes(backend.protocol) || backend.pathname !== '/' || backend.search || backend.hash || backend.username || backend.password) {
  throw new Error('VITE_API_URL must be the backend origin without a path')
}

export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*', destination: `${backend.origin}/api/:path*` },
    { source: '/socket.io/:path*', destination: `${backend.origin}/socket.io/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
}

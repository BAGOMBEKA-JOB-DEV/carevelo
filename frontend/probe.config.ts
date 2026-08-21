import react from '@vitejs/plugin-react'
export default {
  test: {
    projects: [
      { test: { name: 'a', root: '/home/jb/Desktop/carevelo/frontend/scratch', environment: 'jsdom', include: ['**/*.test.ts'] }, plugins: [react()] },
    ],
  },
}

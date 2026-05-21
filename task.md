# TASK: Productionization, Audit, and Dual-Platform Deployment Setup

**Role Assigned:** Senior DevOps & Systems Architect (10+ Years Exp in Real-Time Web Architecture)
**Objective:** Audit the existing local/Vercel codebase, prepare the backend for a zero-cost production environment on Render, bridge the cross-origin communication between Vercel and Render, and map the architecture to a custom domain.

---

## 🛑 Phase 0: Pre-Flight Architecture Audit (Mental Framework)
Before writing code or pushing to production, you must evaluate the project against standard real-time web vulnerabilities. Review the codebase for the following "Senior Dev" red flags:
1. **Hardcoded URLs/Ports:** Ensure there are NO instances of `localhost:3000` or `http://` hardcoded in the networking scripts.
2. **Memory Leaks via Socket Event Listeners:** Ensure listeners inside Three.js component lifecycles are cleaned up (`socket.off()`) to prevent piling up memory.
3. **State Consistency:** Ensure the backend does not rely on global memory arrays that wipe out on a server restart without fallback states.

---

## 🛠️ Phase 1: Codebase Preparation

### Task 1.1: Backend Productionization (`server.js`)
Modify the entry point of the Node.js server to operate under strict cloud platform constraints.
- [ ] **Dynamic Port Binding:** Force the server to listen to the environment-assigned port.
  
```javascript
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => console.log(Game server blazing on port ${PORT}));
[ ] Cross-Origin Resource Sharing (CORS) Protection: Do not allow open wildcards (*). Explicitly check incoming requests against the production Vercel frontend URL.

JavaScript
  const io = require('socket.io')(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      methods: ["GET", "POST"]
    }
  });
Task 1.2: Frontend Networking Isolation (NetworkManager.js)
[ ] Ensure the socket client automatically switches between development environments and the production backend based on the environment build stage.

JavaScript
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
  const socket = io(BACKEND_URL);
🚀 Phase 2: Live Deployment to Render.com (Free Tier)
Execute the live backend infrastructure setup via Render's dashboard.

[ ] Isolate the Repository: If the project is a monorepo, configure the root directory correctly. If not, spin up a separate GitHub repository solely containing the backend (server.js, package.json, and dependencies).

[ ] Provision Render Web Service:

Create a new Web Service on Render.

Connect the backend GitHub repository.

Runtime: Node

Build Command: npm install

Start Command: node server.js (or npm start)

Instance Type: Free

[ ] Inject Environment Variables: In the Render dashboard, navigate to Environment and define:

FRONTEND_URL = https://your-custom-or-vercel-domain.com

[ ] Verify Live Logs: Monitor the streaming log terminal to ensure the WebSocket listener initializes successfully without crashing. Note down the public Render URL assigned (e.g., https://threejs-fight-backend.onrender.com).

🌐 Phase 3: Custom Domain Mapping & Vercel Update
[ ] Update Vercel Configuration: Go to the Vercel dashboard for your frontend project, navigate to Project Settings -> Environment Variables, and inject:

VITE_BACKEND_URL = https://your-new-render-backend-url.onrender.com

[ ] Trigger Frontend Re-deployment: Force a clean rebuild on Vercel so the environment variable is compiled into the client production code.

[ ] Custom Domain Allocation:

To hook up a uniform domain name, decide where the DNS points.

Option A (Subdomain Approach - Recommended): If you own mygame.com, map it to Vercel. Then, create a CNAME record at your DNS provider pointing api.mygame.com directly to Render's URL.

Option B (Standard): Let Vercel handle the apex domain (mygame.com), and keep the backend routing cleanly through Render's system out-of-the-box.

🩺 Phase 4: Production Resilience & Ping Controls
Free tier tiers on Render spin down after 15 minutes of inactivity. We must intercept this behavior to protect player matchmaking times.

[ ] Waking System: Set up an external heartbeat loop using a service like cron-job.org or an automated script to ping https://your-new-render-backend-url.onrender.com/health every 10 minutes.

[ ] Frontend Handshake Grace Period: Add a visual indicator in the Three.js canvas UI stating "Waking Up Combat Servers..." if the connection handshake takes longer than 2500ms.

🧠 Senior Architectural Counter-Questions for the Agent to Answer First:
Stop! Do not execute code changes until you analyze and present structural solutions to the following queries:

State Machine Handling during Restarts: Render's free tier recycles containers routinely. If the backend restarts mid-match, how will your client-side architecture handle a sudden disconnect socket state? Will it gracefully redirect back to the Selection screen, or will it throw a fatal Three.js rendering loop crash?

Floating-Point Network Garbage Collection: Are your character transforms (x, y, z, rotations) being stringified as raw double-precision floats over the wire? If so, what is your plan to compress or truncate these metrics to maximize free network data margins?

Asset Delivery Race Condition: With the application running on separate networks (Vercel vs Render), what mechanism handles a scenario where a user successfully authenticates onto the backend room via socket before their browser finishes downloading the 3D GLTF asset structures from Vercel?
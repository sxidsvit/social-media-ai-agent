# Social Media AI Agent

An end-to-end autonomous agentic system designed to plan, generate, schedule, and analyze content across multiple social media platforms using artificial intelligence.

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Architecture & Technical Documentation](#-architecture--technical-documentation)
- [Documentation Links (Techdocs)](#-documentation-links-techdocs)
- [Installation & Local Development](#-installation--local-development)
  - [Prerequisites](#prerequisites)
  - [Step-by-Step Installation](#step-by-step-installation)
  - [Environment Variables](#environment-variables)
- [Deployment](#-deployment)
- [License](#-license)
- [Connect with me & Acknowledgements](#-connect-with-me)

---

## 🎯 Project Overview

The **Social Media AI Agent** (Socialix) is designed to automate the lifecycle of content management for modern marketing teams and creators. Built with Next.js, Google Generative AI, and Inngest background orchestration pipelines, the application enables multi-platform AI post generation, dynamic scheduling, multi-agent workflows, and automated social media distribution.

---

## ✨ Key Features

- 🤖 **AI Content Orchestration:** Automated multi-platform post generation powered by `@google/genai` (Gemini API).
- ⚙️ **Event-Driven Workflows:** Serverless background job queue and event orchestration managed by **Inngest**.
- 📅 **Dynamic Scheduling Engine:** Automated queuing, cron triggers, and publishing workflows.
- 🗄️ **Type-Safe Persistence:** PostgreSQL database management via **Supabase** and **Drizzle ORM**.
- 🔑 **Authentication & User Management:** Secure multi-tenant authentication powered by **Clerk**.
- 📄 **Comprehensive Technical Specs:** In-depth architectural reports and diagrammatic specifications in `/techdocs`.

---

## 🛠 Tech Stack

- **Framework & UI:** Next.js, React, Tailwind CSS, TypeScript, Lucide React, Shadcn/UI components
- **AI & LLM Services:** `@google/genai` (Google Gemini API)
- **Background Jobs & Workflows:** Inngest
- **Database & ORM:** PostgreSQL (Supabase), Drizzle ORM, Drizzle Kit
- **Authentication:** Clerk (`@clerk/nextjs`)
- **HTTP Client & Utilities:** Axios, clsx, tailwind-merge

---

## 🏗 Architecture & Technical Documentation

The application relies on an asynchronous event-driven model to coordinate content generation pipelines and scheduled publishing. Below are the architectural design documents detailing component relationships, messaging pipelines, and database models.

### System Architecture Overview

![Architecture Overview](./techdocs/SOCIALIX_PLATFORM_AI-DRIVEN_AGENT_ARCHITECTURE_%26_WORKFLOW.jpg)

_Figure 1: High-level overview of backend services, database persistent storage, and worker queues._

### Messaging Architecture

![Messaging Architecture](./techdocs/AI_Multi-Agent_Task_Lifecycle.jpg)

_Figure 2: Interaction between worker threads, LLM orchestration layers, and external platform APIs._

---

## 📁 Documentation Links (Techdocs)

Explore the full directory here: 📁 [/techdocs Folder](./techdocs)

### Technical Reports

- <a href="./techdocs/TECHNICALREPORT_AND_ARCHITECTURAL_SPECIFICATION_aas_socialix.pdf" target="_blank">TECHNICAL REPORT AND ARCHITECTURAL SPECIFICATION (PDF)</a>

### Graphical Diagrams

- [Architecture Diagram](./techdocs/SOCIALIX_PLATFORM_AI-DRIVEN_AGENT_ARCHITECTURE_%26_WORKFLOW.jpg)
- [Messaging Architecture Diagram](./techdocs/AI_Multi-Agent_Task_Lifecycle.jpg)

---

## 🚀 Installation & Local Development

### Prerequisites

- Node.js >= 18.0.0
- npm / pnpm / yarn
- Supabase / PostgreSQL database
- Clerk account
- Google Gemini API key

### Step-by-Step Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/sxidsvit/social-media-ai-agent.git
   cd social-media-ai-agent
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Copy the example environment file and fill in your keys:

   ```bash
   cp .env.local.example .env.local
   ```

4. **Push database schema:**

   ```bash
   npx drizzle-kit push
   ```

5. **Run the development server:**

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Environment Variables

Add the following to your `.env.local` file:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Database (Supabase + Drizzle)
DATABASE_URL=postgresql://user:password@localhost:5432/social_agent

# AI Engine
GEMINI_API_KEY=your_gemini_api_key

# Authentication (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_pub_key
CLERK_SECRET_KEY=your_clerk_secret_key

# Background Jobs (Inngest)
INNGEST_EVENT_KEY=your_inngest_event_key
INNGEST_SIGNING_KEY=your_inngest_signing_key
```

---

## 🌐 Deployment

### Deploy on Vercel

1. Push your repository to GitHub.
2. Import the project into Vercel.
3. Configure environment variables in the Vercel project settings.
4. Set up Inngest webhook endpoints and Supabase connection strings.

---

### 📬 Connect with me

<a href="https://www.linkedin.com/in/sergiy-antonyuk/" target="_blank">
<img alt="Sergiy Antonyuk | LinkedIn" src="https://img.shields.io/badge/LinkedIn-0077B5.svg?&style=for-the-badge&logo=linkedin&logoColor=white" />
</a>

#### 🙏 Acknowledgements

This project is a version of the original project [Socialix](https://www.youtube.com/watch?v=vNXrFMSAsOA).

A heartfelt thank you to [TubeGuruji](https://www.youtube.com/@tubeguruji) for his invaluable contributions.

I used it for educational purposes to study its device in detail and created detailed technical documentation.

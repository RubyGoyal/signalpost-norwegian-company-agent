# Signalpost — Norwegian Company Intelligence Agent

An AI-powered agent that researches Norwegian companies using public sources, verifies company information, and maintains company profiles with traceable evidence.

## Overview

Signalpost helps users look up Norwegian companies using their organisation numbers. It combines official registry data with AI-assisted research to collect relevant company information, validate claims, and provide links to supporting sources.

## Features

- **Company lookup:** Search for Norwegian companies using their nine-digit organisation numbers.
- **Official registry integration:** Retrieve company details from the Brønnøysund Register Centre.
- **AI-powered research:** Discover relevant company information from permitted public sources.
- **Source verification:** Associate company facts with source URLs and available dates.
- **Entity validation:** Check that retrieved information belongs to the correct company.
- **Conflict handling:** Flag conflicting or unverified claims rather than presenting them as confirmed facts.
- **Company profiles:** Browse and filter company records.
- **Profile updates:** Track changes to company information over time.
- **Data export:** Export available company records in JSON or JSONL format.

## Data Sources

Signalpost uses public company information, including:

- [Brønnøysund Register Centre](https://www.brreg.no/)
- [Enhetsregisteret API](https://data.brreg.no/enhetsregisteret/api/)
- Other permitted public sources, where available and relevant.

Information availability depends on the source and the company.

## Technology Stack

- React
- TypeScript
- Node.js
- Official Norwegian company registry APIs
- Gemini API for AI-assisted research, depending on the configured model and API settings

## Getting Started

### Prerequisites

- Node.js and npm
- Required API credentials for the configured AI services

### Installation

Clone the repository:

```bash
git clone https://github.com/RubyGoyal/signalpost-norwegian-company-agent.git
cd signalpost-norwegian-company-agent
```

Install dependencies:

```bash
npm install
```

Configure the required environment variables using the project's environment example file, if provided. Keep API keys and other secrets out of version control.

### Run the Application

Start the development server using the command configured in `package.json`. For example, if the project defines the `dev` script:

```bash
npm run dev
```

## Usage

Enter a valid Norwegian organisation number to retrieve the corresponding company profile.

The agent aims to provide:

- Company identification details
- Relevant company facts
- Source links and available publication dates
- Verification status and explanations
- Information about conflicting or unverified claims

The exact fields depend on the available registry data and research results.

## Responsible Data Handling

Signalpost prioritises traceable sources and company identity verification. Unverified information and conflicting claims should be clearly identified, and financial figures should not be presented as confirmed without reliable supporting evidence.

## Repository

[GitHub — Signalpost Norwegian Company Intelligence Agent](https://github.com/RubyGoyal/signalpost-norwegian-company-agent)

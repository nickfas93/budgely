/**
 * Agente de análise financeira pessoal (NIC-108).
 *
 * Utiliza Claude Sonnet com um system prompt especializado que incorpora:
 * - "The Psychology of Money" (Morgan Housel) — comportamento, disciplina, composição
 * - "Como Organizar Sua Vida Financeira" (Gustavo Cerbasi) — framework brasileiro:
 *   PMS, PMR, PI, PNIF, regra dos 10%, orçamento doméstico
 *
 * Recebe um snapshot financeiro do usuário (JSON) + pergunta em linguagem natural.
 * Retorna análise em português brasileiro, focada em dados reais, acionável, sem sermões.
 */
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'

// ─── Tipos de entrada ──────────────────────────────────────────────────────────

export interface CategorySnapshot {
  slug: string
  label: string
  spent: number
  budget: number | null
}

export interface MonthSnapshot {
  month: string            // YYYY-MM-DD (primeiro dia do mês)
  monthly_salary: number
  total_spent: number
  total_income: number
  savings: number          // total_income - total_spent
  savings_rate: number     // savings / total_income (0–1)
  categories: CategorySnapshot[]
  alelo?: {
    refeicao_budget: number | null
    alimentacao_budget: number | null
    spent_refeicao: number
    spent_alimentacao: number
  } | null
}

export interface FinancialContext {
  months: MonthSnapshot[]          // cronológico, mais antigo primeiro, até 6 meses
  current_month: MonthSnapshot
  user_message: string
}

// ─── System prompt ─────────────────────────────────────────────────────────────

export const FINANCE_AGENT_SYSTEM_PROMPT = `Você é Fin, o assistente financeiro pessoal do Budgely.
Você analisa dados reais de gastos do usuário e oferece orientações práticas e honestas.

## Sua personalidade
- Direto, empático, sem julgamentos morais
- Usa dados concretos — cite valores reais da conversa, nunca invente números
- Não é vendedor de produto financeiro nem guru motivacional
- Reconhece progresso genuíno com objetividade

## Framework de análise (use internamente, não cite como teoria)

### Psicologia do Dinheiro (Housel)
- O que importa não é quanto você ganha, mas quanto você guarda — taxa de poupança > taxa de retorno
- Compounding exige tempo: pequenas melhorias consistentes superam grandes esforços esporádicos
- "Suficiente" é uma virtude — otimizar indefinidamente tem custo emocional real
- Volatilidade é pedágio, não multa — comportamento em meses ruins define resultados de longo prazo
- Margem de segurança: reserve antes de investir, não o contrário
- Você controla: quanto gasta, quanto poupa, por quanto tempo. Não controla mercado ou inflação.

### Cerbasi — Framework Patrimonial Brasileiro
Use estes indicadores como régua silenciosa ao analisar dados:
- **PMS** (Patrimônio Mínimo de Segurança) = 6× despesas mensais → reserva de emergência
- **PMR** (Patrimônio Mínimo para Renda) = 12–20× despesas anuais → para gerar renda passiva básica
- **PI** (Patrimônio Ideal) = 10% × despesas anuais × idade do usuário (se informada)
- **PNIF** (Independência Financeira) = despesas anuais ÷ taxa de rendimento anual real
- **Regra dos 10%**: poupar ao menos 10% da renda bruta como ponto de partida
- Prioridade de dívidas: juros de cartão de crédito (>10%/mês no Brasil) destroem patrimônio — liquide primeiro
- Orçamento saudável orientativo: moradia ≤30%, transporte ≤15%, alimentação ≤15%, lazer ≤10%, poupança ≥10%

### Dados do Budgely
- Despesas: valores **negativos** nas transações (ex: -150.00 = R$150 gasto)
- Receitas: valores **positivos**
- Categorias: alimentacao, refeicao, moradia, saude, lazer, vestuario, transporte, educacao, pets, servicos, outros
- Alelo: cartão de benefícios com carteiras separadas (refeição e alimentação)
- Fontes: pdf_credit (crédito Itaú), pdf_debit (débito Itaú), pdf_alelo (Alelo)

## Regras de resposta obrigatórias

1. **Tamanho máximo: 350 palavras.** Se a análise precisar de mais, escolha o ponto mais relevante e ofereça aprofundar em outra mensagem.
2. **Sempre comece com o dado mais relevante** do contexto fornecido — não comece com "Olá" ou introduções genéricas.
3. **Inclua 1 a 3 ações concretas** ao final, no formato:
   → [ação específica com valor ou prazo quando possível]
4. **Se os dados forem insuficientes** para responder à pergunta, diga exatamente quais meses ou categorias estão faltando.
5. **Nunca invente dados** que não estejam no contexto fornecido.
6. **Foco no que o usuário pode controlar agora** — não em cenários hipotéticos distantes.
7. Use **R$** com valores formatados (ex: R$ 1.250,00) e **%** para percentuais.
8. Responda sempre em **português brasileiro**.`

// ─── Função principal ───────────────────────────────────────────────────────────

export async function analyzeFinances(ctx: FinancialContext): Promise<string> {
  const userContent = buildUserMessage(ctx)

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: FINANCE_AGENT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })

  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Resposta inesperada da API Claude')
  return block.text
}

// ─── Builder de contexto ────────────────────────────────────────────────────────

function fmtBRL(n: number): string {
  return `R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function buildMonthSummary(m: MonthSnapshot): string {
  const lines: string[] = [
    `### ${m.month.slice(0, 7)}`,
    `Receita: ${fmtBRL(m.total_income)} | Gasto: ${fmtBRL(m.total_spent)} | Poupança: ${fmtBRL(m.savings)} (${fmtPct(m.savings_rate)})`,
  ]

  if (m.categories.length > 0) {
    lines.push('Gastos por categoria:')
    for (const c of m.categories) {
      const budget = c.budget != null ? ` / orçamento ${fmtBRL(c.budget)}` : ''
      lines.push(`  - ${c.label}: ${fmtBRL(c.spent)}${budget}`)
    }
  }

  if (m.alelo) {
    const { refeicao_budget, alimentacao_budget, spent_refeicao, spent_alimentacao } = m.alelo
    const rfBudget = refeicao_budget != null ? ` / orçamento ${fmtBRL(refeicao_budget)}` : ''
    const alBudget = alimentacao_budget != null ? ` / orçamento ${fmtBRL(alimentacao_budget)}` : ''
    lines.push(`Alelo refeição: ${fmtBRL(spent_refeicao)}${rfBudget}`)
    lines.push(`Alelo alimentação: ${fmtBRL(spent_alimentacao)}${alBudget}`)
  }

  return lines.join('\n')
}

function buildUserMessage(ctx: FinancialContext): string {
  const sections: string[] = []

  if (ctx.months.length > 1) {
    sections.push('## Histórico financeiro (últimos meses)')
    for (const m of ctx.months.slice(0, -1)) {
      sections.push(buildMonthSummary(m))
    }
  }

  sections.push('## Mês atual')
  sections.push(buildMonthSummary(ctx.current_month))

  sections.push(`## Pergunta do usuário\n${ctx.user_message}`)

  return sections.join('\n\n')
}

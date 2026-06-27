// Seeds iniciais extraídos do brief (sistema.txt).

import type {
  BattleTemplate,
  CatalogItem,
  Disguise,
  GameObject,
  Hack,
  Npc,
  Profession,
  Scenario,
} from "@/game/types";

export const PROFESSIONS: Profession[] = [
  { id: "prof_pugilista", name: "Pugilista", hack_found: true, description: "Você sabe lutar boxe, causa 2 de dano de contusão no combate a mãos livres" },
  { id: "prof_hacker", name: "Hacker", hack_found: false, description: "Você sabe hackear equipamentos para conseguir informações" },
  { id: "prof_soldado", name: "Soldado", hack_found: false, description: "Você diminui a defesa do inimigo em -1 em testes com armas de fogo" },
  { id: "prof_atleta", name: "Atleta", hack_found: true, description: "Você recebe +2 em testes para corridas e acrobacias" },
  { id: "prof_artista", name: "Artista", hack_found: false, description: "Você sabe fazer performances artísticas" },
  { id: "prof_aviador", name: "Aviador", hack_found: false, description: "Você sabe pilotar aviões e helicópteros" },
  { id: "prof_motorista", name: "Motorista", hack_found: true, description: "Você recebe +2 em testes de condução de veículos terrestres" },
  { id: "prof_desenhista", name: "Desenhista", hack_found: false, description: "Você sabe fazer desenhos complexos em folhas ou quadros" },
  { id: "prof_medico", name: "Médico", hack_found: false, description: "Você pode, fora de combate, curar 1 de dano para você e todos aliados" },
  { id: "prof_engenheiro", name: "Engenheiro", hack_found: true, description: "Você entende o funcionamento e pode consertar máquinas" },
  { id: "prof_cirurgiao", name: "Cirurgião", hack_found: false, description: "Você entende de anatomia e sabe fazer cirurgias" },
  { id: "prof_detetive", name: "Detetive", hack_found: false, description: "Você ganha +2 em testes para perceber atividades suspeitas ou examinar locais" },
  { id: "prof_biologo", name: "Biólogo", hack_found: false, description: "Você sabe lecionar e entende sobre Biologia" },
  { id: "prof_matematico", name: "Matemático", hack_found: false, description: "Você sabe lecionar e entende sobre Matemática" },
  { id: "prof_poliglota", name: "Poliglota", hack_found: true, description: "Você sabe mais 2 línguas à sua escolha" },
  { id: "prof_cozinheiro", name: "Cozinheiro", hack_found: false, description: "Você entende sobre culinária e sabe cozinhar" },
  { id: "prof_barman", name: "Barman", hack_found: true, description: "Você sabe fazer drinks saborosos e entende de bebidas" },
  { id: "prof_filosofo", name: "Filósofo", hack_found: true, description: "Você sabe lecionar e entende sobre Filosofia" },
];

export const ITEMS: CatalogItem[] = [
  // Armas (range = alcance em casas)
  { id: "wpn_maos_livres", category: "weapon", name: "Mãos Livres", damage: "1d4", range: 1, description: "Combate desarmado." },
  { id: "wpn_taco", category: "weapon", name: "Taco / Bastão", damage: "1d6", range: 1 },
  { id: "wpn_faca", category: "weapon", name: "Faca / Canivete", damage: "1d6", range: 1 },
  { id: "wpn_katana", category: "weapon", name: "Katana", damage: "2d6", range: 1 },
  { id: "wpn_revolver", category: "weapon", name: "Revolver", damage: "1d8", range: 4 },
  { id: "wpn_metralhadora", category: "weapon", name: "Metralhadora", damage: "2d8", range: 5, area: 1, description: "Rajada: atinge também os adjacentes ao alvo." },
  { id: "wpn_fuzil", category: "weapon", name: "Fuzil / 12", damage: "2d10", range: 6 },
  { id: "wpn_granada", category: "weapon", name: "Granada", damage: "3d6", range: 4, area: 2, description: "Explosão em área: dano a todos num raio de 2 casas do alvo." },
  // Acessórios
  { id: "acc_colete", category: "accessory", name: "Colete", dfBonus: 2, description: "Ignora 2 de dano." },
  { id: "acc_escudo", category: "accessory", name: "Escudo Policial", dfBonus: 3, mvBonus: -1, description: "Ignora 3 de dano, reduz 1 de movimento." },
  // Items usáveis
  { id: "itm_pente", category: "item", name: "Pente de Bala", description: "Recarrega uma arma de fogo." },
];

export const HACKS: Hack[] = [
  { id: "hack_destravar", name: "Destravar", description: "Abre fechaduras e portas eletrônicas próximas." },
  { id: "hack_camera", name: "Visão de Câmera", description: "Acessa as câmeras de segurança do local e revela inimigos." },
  { id: "hack_sobrecarga", name: "Sobrecarga", description: "Causa um curto em um equipamento ou inimigo sintético adjacente, atordoando-o por 1 turno." },
  { id: "hack_rastrear", name: "Rastrear", description: "Marca um alvo: ataques contra ele recebem +1 enquanto a marca durar." },
  { id: "hack_mascarar", name: "Mascarar Sinal", description: "Some dos sistemas de vigilância por 1 cena (não pode ser detectado eletronicamente)." },
  { id: "hack_paralisar", name: "Paralisar Sistema", description: "Trava elevadores, portões e torres por alguns segundos." },
  { id: "hack_drenar", name: "Drenar Dados", description: "Extrai informações de um terminal ou de um corpo conectado." },
  { id: "hack_espelhar", name: "Espelhar", description: "Copia um hack que você esteja vendo outro usar e o guarda para uso único." },
  { id: "hack_pulso", name: "Pulso EMP", description: "Desliga eletrônicos numa área pequena; some luzes, câmeras e armas eletrônicas." },
  { id: "hack_falsa_ordem", name: "Falsa Ordem", description: "Injeta um comando no Sistema fazendo NPCs comuns obedecerem a uma instrução simples." },
];

export const DISGUISES: Disguise[] = [
  { id: "dis_civil", name: "Civil", description: "Roupas comuns; passa despercebido na multidão urbana." },
  { id: "dis_policial", name: "Policial", description: "Uniforme da lei; concede acesso a áreas isoladas e autoridade sobre civis." },
  { id: "dis_executivo", name: "Executivo", description: "Terno e crachá corporativo; abre portas em prédios empresariais." },
  { id: "dis_seguranca", name: "Segurança Privada", description: "Uniforme de guarda; circula por entradas de serviço e salas de monitoramento." },
  { id: "dis_medico", name: "Equipe Médica", description: "Jaleco e credencial hospitalar; trânsito livre em clínicas e ambulâncias." },
  { id: "dis_entregador", name: "Entregador", description: "Uniforme de entregas; ninguém questiona quem carrega uma caixa." },
  { id: "dis_tecnico", name: "Técnico de Manutenção", description: "Macacão e maleta de ferramentas; acessa casas de máquinas e dutos." },
  { id: "dis_agente", name: "Agente", description: "Terno escuro e óculos; intimida e se confunde com a vigilância do Sistema." },
];

export const OBJECTS: GameObject[] = [
  { id: "obj_cobertura", name: "Coluna de Cobertura", rule: "cobertura" },
  { id: "obj_barricada", name: "Barricada", rule: "cobertura" },
  { id: "obj_municao", name: "Caixa de Munição", rule: "reforco" },
  { id: "obj_oleo", name: "Poça de Óleo", rule: "atrapalho" },
  { id: "obj_mesa", name: "Mesa de Metal", rule: "chute", destroyOnUse: true },
  { id: "obj_suprimentos", name: "Caixa de Suprimentos", rule: "item", itemId: "itm_pente" },
];

export const BATTLE_TEMPLATES: BattleTemplate[] = [
  {
    id: "tpl_emboscada",
    name: "Emboscada de Agentes",
    grid: 5,
    tokens: [
      { id: "tpl1_e1", kind: "enemy", pos: { x: 0, y: 4 }, label: "Agente", hp: 30, maxHp: 30, state: "Disposto", npcId: "npc_agente" },
      { id: "tpl1_e2", kind: "enemy", pos: { x: 4, y: 4 }, label: "Agente", hp: 30, maxHp: 30, state: "Disposto", npcId: "npc_agente" },
      { id: "tpl1_o1", kind: "object", pos: { x: 2, y: 2 }, label: "Coluna de Cobertura", rule: "cobertura", objectId: "obj_cobertura" },
    ],
  },
];

export const NPCS: Npc[] = [
  { id: "npc_agente", name: "Agente", hp: 30, damage: "2d6+2", level: 3, description: "Sentinela do Sistema. Forte, preciso e implacável." },
  { id: "npc_policial", name: "Policial", hp: 15, damage: "1d8", level: 1, description: "Força da lei comum, controlada pela Matrix." },
  { id: "npc_capanga", name: "Capanga", hp: 12, damage: "1d6", level: 1, description: "Brutamontes de aluguel armado com bastão." },
  { id: "npc_cao", name: "Cão de Guarda", hp: 8, damage: "1d6+1", level: 0, description: "Rápido e agressivo; ataca em grupo." },
  { id: "npc_civil", name: "Civil", hp: 6, damage: "1d4", level: 0, hostile: false, description: "Pessoa comum; pode virar Agente a qualquer momento." },
];

export const SCENARIOS: Scenario[] = [
  { id: "scn_construct", name: "O Constructo", image: "", distortion: 0 },
];

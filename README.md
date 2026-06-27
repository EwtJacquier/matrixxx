# MATRIX // mesa

RPG de mesa online temático de _Matrix_, em tempo real. O site inteiro representa
**uma única mesa**: 1 GM + até 4 jogadores compartilham a mesma tela, com modo cenário e
modo batalha em grid. Estética de terminal antigo (fundo preto, verde fosforescente).

> O documento original de regras e premissa do jogo está em [`sistema.txt`](./sistema.txt).
> Este README descreve a aplicação que o implementa.

---

## Stack

- **Next.js 14 (App Router) + TypeScript** — front-end e rotas de API.
- **Servidor Node custom** (`server.ts`) integrando **Socket.IO** no mesmo processo, para
  estado de jogo compartilhado em tempo real.
- **CSS Modules** + um tema global (`src/app/globals.css`) com variáveis de cor e
  scanlines de CRT.
- **`@3d-dice/dice-box`** (WebGL) para dados 3D, com fallback em CSS. A rolagem é
  resolvida no servidor e transmitida a todos, então a animação aparece em todas as telas.
  Os assets (ammo.wasm + temas) são copiados de `node_modules` para
  `public/assets/dice-box/` automaticamente pelo `postinstall`
  (`npm run copy-dice-assets` roda manualmente, se precisar).
- **Persistência em JSON** numa pasta `data/` (sem banco externo).
- **Auth** por e-mail + senha (bcrypt), sessão por cookie httpOnly assinado. **Sem
  recuperação de senha** (anote a sua).

## Como rodar

```bash
npm install
npm run dev      # sobe Next + Socket.IO em http://localhost:3000
```

Build de produção:

```bash
npm run build
npm start
```

Variáveis de ambiente opcionais:

| Variável         | Default | Descrição                                   |
| ---------------- | ------- | ------------------------------------------- |
| `PORT`           | `3000`  | Porta do servidor.                          |
| `SESSION_SECRET` | (dev)   | Segredo HMAC do cookie de sessão.           |
| `SOCKET_DEBUG`   | —       | Se setado, loga o handshake de autenticação.|

### Primeiro acesso

O **cadastro pela tela só cria Jogadores** (máximo 4). O **GM é definido editando o banco
diretamente** em `data/users.json` — não há opção de GM na interface.

1. **Defina o GM** adicionando uma entrada em `data/users.json` (crie o arquivo se não
   existir). Você pode usar **senha em texto puro** no campo `passwordHash` (o login
   aceita texto puro quando não é um hash bcrypt):

   ```json
   [
     {
       "id": "usr_gm",
       "email": "mestre@matrix.com",
       "passwordHash": "suaSenhaAqui",
       "role": "gm",
       "createdAt": 0
     }
   ]
   ```

   Reinicie o servidor após editar. Depois é só entrar com esse e-mail/senha.
2. Os jogadores abrem o site, clicam em **Criar conta** e entram automaticamente como
   **Jogador**.
3. Jogadores preenchem a **Ficha**; o GM usa **Cadastros** e os controles da mesa.

> Só pode existir **um** GM. Contas criadas pela tela guardam um hash bcrypt; o texto puro
> é apenas uma conveniência para editar o GM à mão.

## Estrutura

```
server.ts                 # Next + Socket.IO
src/
  game/                   # regras puras e tipos (sem dependência de browser/node)
    types.ts              # modelos compartilhados
    dice.ts               # parser/resolvedor de fórmulas (1d100, 2d6+2…)
    rules.ts              # dano, piora de estado, distorção
  server/
    data/                 # store JSON (escrita serializada) + seeds
    auth/                 # sessão (HMAC) e contas (bcrypt)
    game/manager.ts       # mutações do estado e PublicState
    socket/index.ts       # handlers de Socket.IO
  app/
    api/auth/*            # signup / login / logout / me
    page.tsx              # login ou mesa
  client/                 # componentes React (Table, Scenario, Battle, Sheet, Catalog…)
  types/dice-box.d.ts     # tipos do @3d-dice/dice-box
data/                     # JSON em runtime (gitignored; seeds gerados no 1º boot)
```

## Modelos de dados

Ver `src/game/types.ts`. Resumo:

- **Character** — `name`, `level` (0–3), `hp/maxHp` (por nível), `mv` (base 2 + acessório),
  `df` (base 0 + acessório; ignora X de dano), `picture` (com crop), `costume`, `roles[]`,
  `hacks[]` (slots 2/3/4 por nível), `items[]` (até 10), `state`.
- **Profession** — `name`, `hack_found`, `description` (seed: tabela do brief).
- **CatalogItem** — `category` (weapon/accessory/item), `damage` (fórmula dado+fixo),
  `range` (alcance em casas), `area` (raio de efeito), `dfBonus`, `mvBonus`.
- **Npc** — inimigo cadastrável (`name`, `hp`, `damage`, ...), usado na montagem da batalha.
- **GameObject** — objeto cadastrável com regra pronta: `behavior`
  (bonus/disadvantage/action/pickup), `value` (modificador por adjacência),
  `damage` (ação especial), `effect` (texto visível a todos).
- **Scenario** — `name`, `image` (data URL), `distortion` (0–10).
- **Token** (batalha) — `kind` (player/enemy/object), `pos`, `hp/maxHp/state`, e para
  objetos `behavior`/`value`/`damage`/`effect`.
- **Roll** — `formula`, `flat`, `results[]`, `total`, `author`, `reason`.

## Ficha de personagem

Estados em ordem de gravidade: **Disposto → Machucado → Incapacitado → Perto da Morte →
Morto**. HP máximo por nível: `10 / 20 / 30 / 40`. Slots de profissões e hacks: `2 / 3 / 4`
nos níveis 1/2/3.

## Fluxo de batalha

1. GM ativa batalha, escolhe o **grid** (4×4 a 7×7) e posiciona jogadores, inimigos (do
   catálogo de NPCs ou genéricos) e objetos (do catálogo). **Não há dois tokens na mesma
   casa.**
2. Ao iniciar, a **iniciativa de todos é rolada automaticamente** (d100, sem botão); os
   turnos seguem a ordem (maior primeiro).
3. O turno tem **dois passos**: primeiro **mover** (a UI destaca as casas alcançáveis;
   diagonal custa 2 — distância de Manhattan) e **confirmar o movimento**; depois **agir**
   (atacar / usar item / ação especial), podendo aplicar **distorção** (1/2/3).
4. **Alcance vem da arma** (`range`); algumas têm **área** (`area`), atingindo todos num
   raio do alvo. Objetos adjacentes dão **+/- automático** e ficam **visíveis** no painel;
   objetos de **ação** (ex.: chutar a mesa) atingem alvos em **linha reta**.
5. **Confirmar a ação** trava a jogada e revela no mapa para todos.
6. GM pode **avançar/retroceder** turno (restaura o snapshot) e **encerra** a batalha →
   volta ao cenário.

## Dados 3D

Qualquer rolagem (iniciativa, ataque, teste) é resolvida no servidor e emitida via socket
(`dice:roll`) para **todos** os clientes, que disparam a mesma animação e exibem o
resultado. Itens/ações usam fórmula **dado + valor fixo** (ex.: `2d6+2`), e o modificador
da distorção entra como bônus no total.

## Regras configuráveis (pontos do brief marcados como "a discutir")

Defaults atuais, fáceis de ajustar em `src/game/rules.ts`:

- **Piora de estado** — quando o HP chega a 0, o estado avança um passo e o HP volta a
  100% do máximo (até "Morto", terminal). Dano recebido é multiplicado conforme o estado
  (`DAMAGE_MULTIPLIER_BY_STATE`).
- **Distorção** — níveis 1/2/3 somam `+1/+2/+3` à ação (`DISTORTION_BONUS`) e ao contador
  de distorção do cenário (0–10).
- **Token-objeto** — comportamentos `bonus` / `disadvantage` / `action` / `pickup`. A
  aplicação automática de bônus por adjacência ainda é um gancho a refinar.

## Verificação rápida

Em duas abas (uma GM, uma jogador): mudanças do GM (cenário, distorção) refletem na hora;
ao iniciar batalha e rolar dados, a animação aparece em ambas. O estado é persistido em
`data/*.json` e sobrevive a um restart do servidor.

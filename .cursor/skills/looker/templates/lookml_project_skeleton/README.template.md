# __PROJECT_NAME__

__PURPOSE__

LookML for the `__PROJECT_NAME__` Looker project, connected to the
`__CONNECTION__` connection.

## Structure

```text
models/
└── __PROJECT_NAME__.model.lkml
views/
└── __PROJECT_NAME__.view.lkml
scripts/
├── mysql_query.py     # ad-hoc query CLI for the backing DB
└── README.md
.cursor/rules/         # LookML coding standards (cursor / agent guidance)
```

## Setup

1. Create a virtualenv and install dependencies:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in credentials:

   ```bash
   cp .env.example .env
   # then edit .env
   ```

3. Export environment variables:

   ```bash
   set -a && source .env && set +a
   ```

4. Sanity-check the connection from the CLI:

   ```bash
   python3 scripts/mysql_query.py describe <table> __CONNECTION__
   ```

## Looker connection

This repo is connected to the `__PROJECT_NAME__` Looker project via
External Git. Branch: `master`. A Looker admin set up the deploy key on
the GitHub side; do not regenerate it without coordinating with them.

## Owner

`__OWNER__`.

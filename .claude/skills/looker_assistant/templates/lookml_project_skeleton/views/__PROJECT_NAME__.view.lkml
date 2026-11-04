view: __PROJECT_NAME__ {
  sql_table_name: __SQL_TABLE_NAME__ ;;

  # -------------------------
  # Keys (hidden)
  # -------------------------

  dimension: id {
    primary_key: yes
    type: number
    sql: ${TABLE}.id ;;
    hidden: yes
  }

  # -------------------------
  # 1. DATE
  # -------------------------

  dimension_group: created {
    type: time
    timeframes: [raw, time, date, week, month, quarter, year]
    sql: ${TABLE}.created_at ;;
    group_label: "1. DATE"
    description: "Row creation timestamp on __SQL_TABLE_NAME__."
  }

  # -------------------------
  # 2. CORE
  # -------------------------

  # Add the dimensions the consumers of this project actually care about.
  # Examples (delete and replace with real columns):
  #
  # dimension: status {
  #   type: string
  #   sql: ${TABLE}.status ;;
  #   group_label: "2. CORE"
  #   description: "Row status."
  # }

  # -------------------------
  # Measures
  # -------------------------

  measure: row_count {
    type: count
    label: "Row Count"
    description: "Total rows in __SQL_TABLE_NAME__ matching the current filters."
    group_label: "Counts"
  }

  measure: distinct_ids {
    type: count_distinct
    sql: ${id} ;;
    label: "Distinct IDs"
    description: "Distinct primary-key values. Equals row_count unless joins fan out."
    group_label: "Counts"
  }
}

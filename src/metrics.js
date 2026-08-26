const statuses = ["queued", "running", "completed", "failed", "cancelled"];

export function renderMetrics(snapshot) {
  const lines = [
    "# HELP deploy_doctor_jobs Current diagnosis jobs by status.",
    "# TYPE deploy_doctor_jobs gauge",
    ...statuses.map((status) => `deploy_doctor_jobs{status="${status}"} ${Number(snapshot.jobs?.[status] || 0)}`),
    "# HELP deploy_doctor_worker_leases_active Workers with an active job lease.",
    "# TYPE deploy_doctor_worker_leases_active gauge",
    `deploy_doctor_worker_leases_active ${Number(snapshot.activeWorkers || 0)}`,
    "# HELP deploy_doctor_worker_leases_expired Running jobs whose lease has expired.",
    "# TYPE deploy_doctor_worker_leases_expired gauge",
    `deploy_doctor_worker_leases_expired ${Number(snapshot.expiredLeases || 0)}`,
    "# HELP deploy_doctor_events_total Persisted audit events.",
    "# TYPE deploy_doctor_events_total counter",
    `deploy_doctor_events_total ${Number(snapshot.events || 0)}`,
  ];
  return `${lines.join("\n")}\n`;
}

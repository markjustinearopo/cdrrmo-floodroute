// Distance along unique mapped edges; whole-road flags and partial closures overlap only once.
export function riskDistanceByBarangay(graph,statusMap={},blockIndex={},barangayAt) {
 const totals={},seen=new Set()
 if(!graph)return totals
 for(let from=0;from<graph.adj.length;from++) for(const edge of graph.adj[from]) {
  const status=statusMap[edge.wayId]
  if(!['blocked','flooded'].includes(status)&&!blockIndex.blockedEdges?.has(edge)&&!blockIndex.floodedEdges?.has(edge))continue
  const key=[Math.min(from,edge.to),Math.max(from,edge.to)].join(':')
  if(seen.has(key))continue
  seen.add(key)
  const brgy=barangayAt(edge.mlat,edge.mlng)
  if(brgy)totals[brgy]=(totals[brgy]||0)+edge.d/1000
 }
 return totals
}

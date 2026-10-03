using 'main.bicep'

param suffix = 'ya332'

// East US 2 had no free Search capacity on 2026-10-03.
param searchLocation = 'westus2'
param alertEmails = [
  'ya332@njit.edu'
]

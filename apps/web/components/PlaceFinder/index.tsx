import React, { useEffect, ChangeEvent, useState, useRef, FC } from 'react'
import { useAutocompleteService, useGoogleMap, usePlacesService } from '@ubilabs/google-maps-react-hooks'

import { Gather, Participant, PlaceFinderSuggestion } from '@customTypes/gather'

import './index.css'
import { GatherModal } from '../GatherModal'
import { Search } from '../Search'
import { DashboardContext } from '@web/context/DashboardContext'

const maxNumberOfSuggestions = 5
const user: Participant = {
  id: 2,
  name: 'Jesper Hodge',
}
const baseUrl = 'http://localhost:4000'

interface HandleCreateArgs {
  name: string
  description: string
  pictures: string[]
}

const encodeParams = (params: Record<string, any>): string => {
  return Object.keys(params)
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join('&')
}

const getGather = async (googlePlace: google.maps.places.PlaceResult) => {
  const params = {
    googleId: googlePlace.place_id,
    location: googlePlace.geometry?.location?.toString(),
  }
  const queryString = encodeParams(params)
  const response = await fetch(`${baseUrl}/gathers?${queryString}`)
  console.log('getGather response: ', response)
  if (response.status !== 200) {
    return []
  }
  const data = await response.json()
  console.log('getGather data: ', data)
  return data
}

const getGathersFromBounds = async (bounds: google.maps.LatLngBounds) => {
  const params = {
    bounds: JSON.stringify(bounds.toJSON()),
  }
  const queryString = encodeParams(params)
  const response = await fetch(`${baseUrl}/gathers?${queryString}`)

  if (response.status !== 200) {
    return []
  }

  console.log('getGather response: ', response)
  const data = await response.json()
  console.log('getGather data: ', data)
  return data
}

const createGather = async (
  googlePlace: google.maps.places.PlaceResult,
  name: string,
  description: string,
  pictures: string[],
) => {
  console.log('createGather googlePlace: ', googlePlace)

  const newGather: Gather = {
    name,
    description,
    pictures,
    googlePlace: {
      googleId: googlePlace.place_id,
      location: googlePlace.geometry?.location?.toString(),
      name: googlePlace.name,
      formatted_address: googlePlace.formatted_address,
      lat: googlePlace.geometry?.location?.lat(),
      lng: googlePlace.geometry?.location?.lng(),
    },
    participants: [user],
  }

  console.log('body: ', JSON.stringify({ gather: newGather }))

  const response = await fetch(`${baseUrl}/gathers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ gather: newGather }),
  })
  console.log('createGather response: ', response)
  const data = await response.json()
  console.log('createGather data: ', data)

  return data
}

const joinGather = async (gatherId: string, newParticipant: Participant) => {
  const response = await fetch(`${baseUrl}/gathers/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ gatherId: gatherId, userId: newParticipant.id }),
  })
  console.log('joinGather response: ', response)
  const data = await response.json()
  console.log('joinGather data: ', data)
  return data
}

const refreshDisplayedEvents = ({
  map,
  setBounds,
  setGatherList,
}: {
  map: google.maps.Map
  setBounds: React.Dispatch<React.SetStateAction<google.maps.LatLngBounds | undefined | null>>
  setGatherList: React.Dispatch<React.SetStateAction<Gather[]>>
}) => {
  const bounds = map.getBounds()

  if (bounds) {
    setBounds(bounds)
    getGathersFromBounds(bounds).then((gathers) => {
      setGatherList(gathers)
    })
  }
}

const PlaceFinder: FC = () => {
  // Define state and refs
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timeout = useRef<NodeJS.Timeout | null>(null)

  const [inputValue, setInputValue] = useState<string>('')
  const [suggestions, setSuggestions] = useState<Array<PlaceFinderSuggestion>>([])
  const [suggestionsAreVisible, setSuggestionsAreVisible] = useState<boolean>(false)
  const [, setBounds] = useState<google.maps.LatLngBounds | undefined | null>(null)

  const {
    setGatherList,
    selectedPlace,
    setSelectedPlace,
    selectedGather,
    setSelectedGather,
    placeModalOpen,
    setPlaceModalOpen,
  } = React.useContext(DashboardContext)

  // Get google map services
  const map = useGoogleMap()
  const autocompleteService = useAutocompleteService()
  const placesService = usePlacesService()

  useEffect(() => {
    if (map) {
      map.addListener('bounds_changed', () => {
        refreshDisplayedEvents({ map, setBounds, setGatherList })
      })
    }
  }, [map, setGatherList, setBounds])

  // Update the user input value
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newInputValue = event.target.value
    setInputValue(newInputValue)

    if (newInputValue.length >= 2) {
      autocompleteService?.getPlacePredictions(
        {
          input: newInputValue,
        },
        (
          predictions: google.maps.places.AutocompletePrediction[] | null,
          status: google.maps.places.PlacesServiceStatus,
        ) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
            return
          }

          const autocompleteSuggestions = predictions.slice(0, maxNumberOfSuggestions).map((prediction) => ({
            id: prediction.place_id,
            label: prediction.description,
          }))

          // Update suggestions for dropdown suggestions list
          setSuggestions(autocompleteSuggestions)
        },
      )
    } else {
      setSuggestions([])
    }

    if (timeout.current) {
      clearTimeout(timeout.current)
    }

    // Show dropdown with a little delay
    timeout.current = setTimeout(() => {
      setSuggestionsAreVisible(true)
    }, 300)
  }

  // TODO: replace the lat/lng stuff with location.toString()!

  // Handle suggestion selection
  const selectSuggestion = (suggestion: PlaceFinderSuggestion) => {
    inputRef.current?.focus()
    setInputValue(suggestion.label)

    // Close dropdown
    setSuggestionsAreVisible(false)

    // Get the location from Places Service of the selected place and zoom to it
    placesService?.getDetails(
      { placeId: suggestion.id },
      async (placeResult: google.maps.places.PlaceResult | null, status: google.maps.places.PlacesServiceStatus) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !placeResult) {
          return
        }

        setSelectedPlace(placeResult)
        setPlaceModalOpen(true)
        const gathers = await getGather(placeResult)
        const gather = gathers[0]

        if (gather) {
          window.alert(JSON.stringify(gather))
          setSelectedGather(gather)
        } else {
          setSelectedGather(null)
        }

        console.log('placeResult: ', placeResult)

        // Get position of the suggestion to move map
        const position = placeResult.geometry?.location

        if (map && position) {
          map.setZoom(14)
          map.panTo(position)
        }
      },
    )
  }

  const handleCreate = async ({ name, description, pictures }: HandleCreateArgs) => {
    console.log('selectedPlace: ', selectedPlace)
    if (selectedPlace) {
      const gather = await createGather(selectedPlace, name, description, pictures)
      setSelectedGather(gather)
      if (map) refreshDisplayedEvents({ map, setBounds, setGatherList })
    }
  }

  const handleJoin = async () => {
    if (!selectedGather?.id || !user) return

    const data = await joinGather(selectedGather.id, user)

    setSelectedGather({
      ...data,
    })
  }

  return (
    <>
      <Search
        inputRef={inputRef}
        inputValue={inputValue}
        suggestions={suggestions}
        suggestionsAreVisible={suggestionsAreVisible}
        handleInputChange={handleInputChange}
        selectSuggestion={selectSuggestion}
      ></Search>
      {placeModalOpen && (
        <GatherModal
          selectedPlace={selectedPlace}
          selectedGather={selectedGather}
          setModalOpen={setPlaceModalOpen}
          handleCreate={handleCreate}
          handleJoin={handleJoin}
        />
      )}
    </>
  )
}

export default PlaceFinder
